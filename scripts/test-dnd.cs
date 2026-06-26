using System;
using System.Runtime.InteropServices;

public class Wnf
{
    [DllImport("ntdll.dll")]
    public static extern int NtQueryWnfStateData(ref ulong StateName, int[] TypeId, IntPtr ExplicitScope, out int ChangeStamp, out int Buffer, ref int BufferSize);

    public static void Main()
    {
        ulong WNF_SHEL_QUIETHOURS_ACTIVE_PROFILE_CHANGED = 0xd83063ea3bf1c75;
        int changeStamp;
        int buffer;
        int bufferSize = 4;
        
        int status = NtQueryWnfStateData(ref WNF_SHEL_QUIETHOURS_ACTIVE_PROFILE_CHANGED, null, IntPtr.Zero, out changeStamp, out buffer, ref bufferSize);
        Console.WriteLine("Status: " + status + ", Buffer: " + buffer);
    }
}
