using System.Diagnostics;
using System.IO.Compression;
using System.Net;
using System.Net.Sockets;
using System.Net.Http.Json;
using System.Reflection;
using System.Text;
using System.Text.Json;

namespace PromptExplorer;

internal static class Program
{
    internal const string Version = "0.4.0";
    internal static readonly string Home = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "PromptExplorer");
    internal static readonly string Data = Path.Combine(Home, "data");
    internal static readonly string Runtime = Path.Combine(Home, "runtime", Version);
    internal static readonly string InstanceFile = Path.Combine(Home, "instance.json");
    internal static readonly string LogFile = Path.Combine(Home, "PromptExplorer.log");
    internal static readonly HttpClient Client = new() { Timeout = TimeSpan.FromSeconds(2) };
    internal static readonly object LogLock = new();

    [STAThread]
    private static int Main(string[] args)
    {
        Directory.CreateDirectory(Home);
        if (args.Length == 2 && args[0] == "--smoke-test") return SmokeTest(args[1]).GetAwaiter().GetResult();
        using var mutex = new Mutex(true, "Local\\PromptExplorer.Portable", out bool ownsMutex);
        if (!ownsMutex)
        {
            try { OpenExisting().GetAwaiter().GetResult(); }
            catch { MessageBox.Show("PromptExplorer ya se está iniciando. Espera unos segundos y vuelve a abrirlo.", "PromptExplorer"); }
            return 0;
        }
        ApplicationConfiguration.Initialize();
        Application.Run(new ExplorerContext());
        return 0;
    }

    internal static void Log(string message)
    {
        lock (LogLock)
        {
            if (File.Exists(LogFile) && new FileInfo(LogFile).Length > 2_000_000) File.Move(LogFile, LogFile + ".previous", true);
            File.AppendAllText(LogFile, DateTimeOffset.Now.ToString("O") + " " + message + Environment.NewLine);
        }
    }

    internal static void PrepareRuntime()
    {
        if (File.Exists(Path.Combine(Runtime, ".ready"))) return;
        string temp = Runtime + "." + Guid.NewGuid().ToString("N");
        Directory.CreateDirectory(temp);
        try
        {
            using Stream stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("PromptExplorer.Payload.zip")
                ?? throw new IOException("No se encontró el paquete de la aplicación.");
            using var archive = new ZipArchive(stream, ZipArchiveMode.Read);
            archive.ExtractToDirectory(temp);
            foreach (var relative in new[] { "node/node.exe", "git/cmd/git.exe", "git/usr/bin/ssh.exe", "app/server.mjs", "app/public/index.html" })
                if (!File.Exists(Path.Combine(temp, relative))) throw new IOException("Falta un componente: " + relative);
            File.WriteAllText(Path.Combine(temp, ".ready"), Version);
            Directory.CreateDirectory(Path.GetDirectoryName(Runtime)!);
            if (Directory.Exists(Runtime)) Directory.Delete(Runtime, true); // Runtime cache only; user data is elsewhere.
            Directory.Move(temp, Runtime);
        }
        finally { if (Directory.Exists(temp)) Directory.Delete(temp, true); }
    }

    internal static int FreePort()
    {
        for (int port = 4317; port < 4347; port++)
        {
            try { var probe = new TcpListener(IPAddress.Loopback, port); probe.Start(); probe.Stop(); return port; }
            catch (SocketException) { }
        }
        throw new IOException("No hay un puerto local disponible entre 4317 y 4346.");
    }

    internal static Process StartServer(int port, string instance, string data, bool isolatedPath = false)
    {
        Directory.CreateDirectory(data);
        var info = new ProcessStartInfo(Path.Combine(Runtime, "node", "node.exe"))
        {
            WorkingDirectory = Path.Combine(Runtime, "app"), UseShellExecute = false,
            CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true
        };
        info.ArgumentList.Add(Path.Combine(Runtime, "app", "server.mjs"));
        info.Environment["PORT"] = port.ToString(); info.Environment["PE_DATA_DIR"] = data; info.Environment["PE_INSTANCE_ID"] = instance;
        string systemPath = isolatedPath ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "System32") : Environment.GetEnvironmentVariable("PATH") ?? "";
        info.Environment["PATH"] = string.Join(Path.PathSeparator, Path.Combine(Runtime, "git", "cmd"), Path.Combine(Runtime, "git", "usr", "bin"), Path.Combine(Runtime, "node"), systemPath);
        var process = new Process { StartInfo = info, EnableRaisingEvents = true };
        process.OutputDataReceived += (_, e) => { if (e.Data != null) Log(e.Data); };
        process.ErrorDataReceived += (_, e) => { if (e.Data != null) Log(e.Data); };
        if (!process.Start()) throw new IOException("No se pudo iniciar el servidor local.");
        process.BeginOutputReadLine(); process.BeginErrorReadLine(); return process;
    }

    internal static async Task WaitForServer(int port, string instance, Process? process = null)
    {
        for (int i = 0; i < 100; i++)
        {
            if (process?.HasExited == true) throw new IOException("El servidor se detuvo. Revisa " + LogFile);
            try
            {
                var result = await Client.GetFromJsonAsync<Health>($"http://127.0.0.1:{port}/health");
                if (result?.app == "PromptExplorer" && result.instance == instance) return;
            }
            catch (HttpRequestException) { }
            catch (TaskCanceledException) { }
            await Task.Delay(150);
        }
        throw new IOException("El servidor local no respondió a tiempo. Revisa " + LogFile);
    }

    internal static void OpenBrowser(int port) => Process.Start(new ProcessStartInfo($"http://127.0.0.1:{port}") { UseShellExecute = true });
    private static async Task OpenExisting()
    {
        var existing = JsonSerializer.Deserialize<Instance>(await File.ReadAllTextAsync(InstanceFile));
        if (existing == null || existing.port < 4317 || existing.port > 4346) throw new IOException();
        await WaitForServer(existing.port, existing.instance); OpenBrowser(existing.port);
    }

    internal static async Task StopServer(Process process, int port, string instance)
    {
        if (process.HasExited) return;
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, $"http://127.0.0.1:{port}/quit");
            request.Headers.Add("X-PromptExplorer", "1"); request.Headers.Add("X-PE-Instance", instance);
            using var response = await Client.SendAsync(request);
            using var wait = new CancellationTokenSource(TimeSpan.FromSeconds(10));
            await process.WaitForExitAsync(wait.Token);
        }
        catch { if (!process.HasExited) process.Kill(true); }
    }

    private static async Task<int> SmokeTest(string output)
    {
        string isolated = Path.Combine(Path.GetTempPath(), "PromptExplorer-smoke-" + Guid.NewGuid().ToString("N"));
        Process? process = null; int port = 0; string instance = Guid.NewGuid().ToString("N");
        try
        {
            PrepareRuntime(); port = FreePort(); process = StartServer(port, instance, isolated, true);
            await WaitForServer(port, instance, process);
            using var handler = new HttpClientHandler { CookieContainer = new CookieContainer() };
            using var client = new HttpClient(handler) { BaseAddress = new Uri($"http://127.0.0.1:{port}"), Timeout = TimeSpan.FromSeconds(45) };
            client.DefaultRequestHeaders.Add("X-PromptExplorer", "1");
            var state = await client.GetAsync("/api/state?profile=0"); state.EnsureSuccessStatusCode();
            var created = await client.PostAsync("/api/new", JsonContent.Create(new { profile = 0, path = "PruebaWindows.md", content = "# Windows portable\n" })); created.EnsureSuccessStatusCode();
            var commit = await client.PostAsync("/api/commit", JsonContent.Create(new { profile = 0, message = "Prueba del ejecutable Windows" }));
            string result = await commit.Content.ReadAsStringAsync();
            if (!commit.IsSuccessStatusCode) throw new IOException("Commit smoke: " + result);
            foreach (string asset in new[] { "/", "/app.js", "/vendor/marked.js", "/vendor/purify.js" }) (await client.GetAsync(asset)).EnsureSuccessStatusCode();
            await File.WriteAllTextAsync(output, JsonSerializer.Serialize(new { ok = true, version = Version, bundledRuntime = true, bundledGit = true, commitCreated = true }));
            return 0;
        }
        catch (Exception e) { await File.WriteAllTextAsync(output, JsonSerializer.Serialize(new { ok = false, error = e.ToString() })); return 1; }
        finally { if (process != null) { await StopServer(process, port, instance); process.Dispose(); } if (Directory.Exists(isolated)) Directory.Delete(isolated, true); }
    }

    internal record Health(string app, string instance);
    internal record Instance(int port, string instance);
}

internal sealed class ExplorerContext : ApplicationContext
{
    private readonly NotifyIcon tray;
    private Process? server;
    private int port;
    private readonly string instance = Guid.NewGuid().ToString("N");
    private bool closing;

    internal ExplorerContext()
    {
        var menu = new ContextMenuStrip();
        menu.Items.Add("Abrir PromptExplorer", null, (_, _) => { if (server != null && !server.HasExited) Program.OpenBrowser(port); });
        menu.Items.Add("Carpeta de datos", null, (_, _) => Process.Start(new ProcessStartInfo(Program.Home) { UseShellExecute = true }));
        menu.Items.Add("Salir", null, async (_, _) => await Close());
        tray = new NotifyIcon { Icon = SystemIcons.Application, Text = "PromptExplorer · iniciando", Visible = true, ContextMenuStrip = menu };
        tray.DoubleClick += (_, _) => { if (server != null && !server.HasExited) Program.OpenBrowser(port); };
        Application.Idle += Start;
    }

    private async void Start(object? sender, EventArgs args)
    {
        Application.Idle -= Start;
        try
        {
            await Task.Run(Program.PrepareRuntime);
            if (closing) return;
            port = Program.FreePort(); server = Program.StartServer(port, instance, Program.Data);
            await Program.WaitForServer(port, instance, server);
            await File.WriteAllTextAsync(Program.InstanceFile, JsonSerializer.Serialize(new Program.Instance(port, instance)));
            tray.Text = "PromptExplorer · clic derecho para cerrar";
            Program.OpenBrowser(port);
        }
        catch (Exception e)
        {
            Program.Log(e.ToString());
            MessageBox.Show("No se pudo abrir PromptExplorer.\n\n" + e.Message, "PromptExplorer", MessageBoxButtons.OK, MessageBoxIcon.Error);
            await Close();
        }
    }

    private async Task Close()
    {
        if (closing) return; closing = true;
        tray.Text = "PromptExplorer · cerrando";
        if (server != null) { await Program.StopServer(server, port, instance); server.Dispose(); }
        if (File.Exists(Program.InstanceFile)) File.Delete(Program.InstanceFile);
        tray.Visible = false; tray.Dispose(); ExitThread();
    }
}
