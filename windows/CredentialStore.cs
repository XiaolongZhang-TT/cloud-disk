using System.Runtime.InteropServices;
using System.Text;

namespace Tern.Windows;

/// <summary>
/// Stores the WebDAV password in Windows Credential Manager. The password is
/// deliberately never written to settings.json or the log file.
/// </summary>
public static class CredentialStore
{
    private const uint CredTypeGeneric = 1;
    private const uint CredPersistLocalMachine = 2;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct Credential
    {
        public uint Flags;
        public uint Type;
        public string TargetName;
        public string? Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public uint CredentialBlobSize;
        public IntPtr CredentialBlob;
        public uint Persist;
        public uint AttributeCount;
        public IntPtr Attributes;
        public string? TargetAlias;
        public string UserName;
    }

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredWrite(ref Credential credential, uint flags);

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredRead(string target, uint type, uint flags, out IntPtr credential);

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredDelete(string target, uint type, uint flags);

    [DllImport("advapi32.dll")]
    private static extern void CredFree(IntPtr buffer);

    private static string TargetFor(string serverUrl, string username) =>
        $"Tern:{serverUrl}|{username}";

    public static bool Save(string serverUrl, string username, string password)
    {
        var target = TargetFor(serverUrl, username);
        var blob = Encoding.Unicode.GetBytes(password);
        var blobPtr = Marshal.AllocCoTaskMem(blob.Length);
        try
        {
            Marshal.Copy(blob, 0, blobPtr, blob.Length);
            var credential = new Credential
            {
                Type = CredTypeGeneric,
                TargetName = target,
                UserName = username,
                Comment = "Tern WebDAV",
                CredentialBlobSize = (uint)blob.Length,
                CredentialBlob = blobPtr,
                Persist = CredPersistLocalMachine,
            };

            if (CredWrite(ref credential, 0))
            {
                Log.Info($"凭据已保存到 Windows 凭据管理器：{username}@{serverUrl}");
                return true;
            }

            Log.Warn($"凭据保存失败：{Marshal.GetLastWin32Error()}");
            return false;
        }
        finally
        {
            Marshal.FreeCoTaskMem(blobPtr);
        }
    }

    public static string? Load(string serverUrl, string username)
    {
        var target = TargetFor(serverUrl, username);
        if (!CredRead(target, CredTypeGeneric, 0, out var pointer)) return null;

        try
        {
            var credential = Marshal.PtrToStructure<Credential>(pointer);
            if (credential.CredentialBlob == IntPtr.Zero || credential.CredentialBlobSize == 0) return null;
            return Marshal.PtrToStringUni(
                credential.CredentialBlob,
                (int)credential.CredentialBlobSize / 2);
        }
        finally
        {
            CredFree(pointer);
        }
    }

    public static bool Delete(string serverUrl, string username)
    {
        return CredDelete(TargetFor(serverUrl, username), CredTypeGeneric, 0);
    }

    public static bool Has(string serverUrl, string username) =>
        Load(serverUrl, username) is not null;
}
