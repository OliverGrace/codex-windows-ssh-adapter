using System;
using System.IO;
using System.Text;
using System.Diagnostics;
using System.Threading.Tasks;
using System.Runtime.InteropServices;
using System.Collections.Generic;
using System.Web.Script.Serialization;
using System.Threading;
using System.Security.Principal;
using System.Security.Cryptography;

// Binary-safe process launcher. This executable is resolved only by the dedicated
// desktop launcher's PATH; the system OpenSSH installation is never modified.
class SshLauncher {
    static Mutex hostMutex = null;
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll")] static extern bool SetInformationJobObject(IntPtr job, int info, IntPtr data, uint size);
    [DllImport("kernel32.dll")] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int kind);
    [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll")] static extern bool DuplicateHandle(IntPtr sourceProcess, IntPtr source, IntPtr targetProcess, out IntPtr target, uint access, bool inherit, uint options);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool CreateProcess(string executable, StringBuilder commandLine, IntPtr processAttributes, IntPtr threadAttributes, bool inheritHandles, uint flags, IntPtr environment, string directory, ref StartupInfo startup, out ProcessInfo process);
    [DllImport("kernel32.dll")] static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle, uint timeout);
    [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr process, out uint code);
    [DllImport("kernel32.dll")] static extern bool TerminateProcess(IntPtr process, uint code);
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct StartupInfo {
        public uint cb; public string reserved, desktop, title;
        public uint x,y,xSize,ySize,xCountChars,yCountChars,fillAttribute,flags;
        public ushort showWindow, reserved2; public IntPtr reservedPtr, input, output, error;
    }
    [StructLayout(LayoutKind.Sequential)] struct ProcessInfo { public IntPtr process, thread; public uint processId, threadId; }
    static IntPtr InheritStandardHandle(int kind) {
        IntPtr duplicate; var current=GetCurrentProcess();
        if (!DuplicateHandle(current,GetStdHandle(kind),current,out duplicate,0,true,2)) throw new Exception("Cannot inherit standard handle");
        return duplicate;
    }
    [StructLayout(LayoutKind.Sequential)] struct BasicLimits {
        public long PerProcessUserTimeLimit, PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass, SchedulingClass;
    }
    [StructLayout(LayoutKind.Sequential)] struct IoCounters {
        public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount, ReadTransferCount, WriteTransferCount, OtherTransferCount;
    }
    [StructLayout(LayoutKind.Sequential)] struct ExtendedLimits {
        public BasicLimits BasicLimitInformation;
        public IoCounters IoInfo;
        public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed;
    }
    static IntPtr MakeJob() {
        var job = CreateJobObject(IntPtr.Zero, null);
        if (job == IntPtr.Zero) throw new Exception("Cannot create adapter process job");
        var limits = new ExtendedLimits(); limits.BasicLimitInformation.LimitFlags = 0x2000; // KILL_ON_JOB_CLOSE
        int size = Marshal.SizeOf(limits); IntPtr data = Marshal.AllocHGlobal(size);
        try {
            Marshal.StructureToPtr(limits, data, false);
            if (!SetInformationJobObject(job, 9, data, (uint)size)) { CloseHandle(job); throw new Exception("Cannot configure adapter process job"); }
        } finally { Marshal.FreeHGlobal(data); }
        return job;
    }
    static string Quote(string arg) {
        var b = new StringBuilder("\""); int slashes = 0;
        foreach (char c in arg) {
            if (c == '\\') { slashes++; continue; }
            if (c == '"') b.Append('\\', slashes * 2 + 1).Append(c);
            else b.Append('\\', slashes).Append(c);
            slashes = 0;
        }
        return b.Append('\\', slashes * 2).Append('"').ToString();
    }
    static int Main(string[] args) {
        IntPtr job = IntPtr.Zero;
        try {
            string bin = AppDomain.CurrentDomain.BaseDirectory;
#if DURABLE_HOST
            bool created;
            string stateDir = Path.GetFullPath(Path.Combine(bin,".."));
            string instanceHash;
            using(var hash=SHA256.Create()) instanceHash=BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(stateDir.ToUpperInvariant()))).Replace("-","");
            hostMutex = new Mutex(true,"Global\\CodexWindowsSshAdapter-"+WindowsIdentity.GetCurrent().User.Value+"-"+instanceHash,out created);
            if (!created) return 0;
            Environment.SetEnvironmentVariable("CODEX_ADAPTER_STATE",stateDir);
            var cfg = new JavaScriptSerializer().Deserialize<Dictionary<string,string>>(File.ReadAllText(Path.Combine(stateDir,"settings.json")));
            var arguments = new StringBuilder(Quote(cfg["node"])+" "+Quote(Path.Combine(bin,"host.mjs")));
#elif REMOTE_PROXY
            string stateDir = Path.GetFullPath(Path.Combine(bin,".."));
            var cfg = new JavaScriptSerializer().Deserialize<Dictionary<string,string>>(File.ReadAllText(Path.Combine(stateDir,"settings.json")));
            var arguments = new StringBuilder(Quote(cfg["node"])+" "+Quote(Path.Combine(bin,"proxy.mjs")));
            foreach (var arg in args) arguments.Append(' ').Append(Quote(arg));
#else
            var cfg = new JavaScriptSerializer().Deserialize<Dictionary<string,string>>(File.ReadAllText(Path.Combine(bin, "runtime.json")));
            var arguments = new StringBuilder(Quote(cfg["node"]) + " " + Quote(Path.GetFullPath(Path.Combine(bin, "..", "src", "ssh-adapter.mjs"))));
            foreach (var arg in args) arguments.Append(' ').Append(Quote(arg));
#endif
            // Desktop's Electron variables must not reinterpret Node or inject a loader.
            Environment.SetEnvironmentVariable("ELECTRON_RUN_AS_NODE",null);
            Environment.SetEnvironmentVariable("NODE_OPTIONS",null);
            job = MakeJob();
            var si=new StartupInfo();si.cb=(uint)Marshal.SizeOf(si);
#if !DURABLE_HOST
            si.flags=0x100;
            si.input=InheritStandardHandle(-10);si.output=InheritStandardHandle(-11);si.error=InheritStandardHandle(-12);
#endif
            ProcessInfo pi;
            try {
                if (!CreateProcess(cfg["node"],arguments,IntPtr.Zero,IntPtr.Zero,si.flags!=0,0x08000004,IntPtr.Zero,null,ref si,out pi))
                    throw new Exception("Cannot launch Node: " + Marshal.GetLastWin32Error());
            } finally {CloseHandle(si.input);CloseHandle(si.output);CloseHandle(si.error);}
            try {
                // Assign while suspended: no child process can escape the job.
                if (!AssignProcessToJobObject(job,pi.process)) {TerminateProcess(pi.process,127);throw new Exception("Cannot attach adapter to process job");}
                ResumeThread(pi.thread);WaitForSingleObject(pi.process,0xffffffff);
                uint code;GetExitCodeProcess(pi.process,out code);return unchecked((int)code);
            } finally {
                CloseHandle(pi.thread);CloseHandle(pi.process);
            }
        } catch (Exception e) { Console.Error.WriteLine("[Codex Windows SSH adapter] Launcher: " + e.Message); return 127; }
        finally { if (job != IntPtr.Zero) CloseHandle(job); if(hostMutex!=null)hostMutex.Dispose(); }
    }
}
