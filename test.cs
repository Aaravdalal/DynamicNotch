using System;
using System.Runtime.InteropServices;

[ComImport]
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDeviceEnumerator
{
    int EnumAudioEndpoints(int dataFlow, int stateMask, out IntPtr ppDevices);
    [PreserveSig]
    int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice ppEndpoint);
    int GetDevice(string pwstrId, out IMMDevice ppDevice);
    int RegisterEndpointNotificationCallback(IntPtr pClient);
    int UnregisterEndpointNotificationCallback(IntPtr pClient);
}

[ComImport]
[Guid("D666063F-1587-4E43-81F1-B948E807363F")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDevice
{
    [PreserveSig]
    int Activate(ref Guid iid, int dwClsCtx, IntPtr pActivationParams, [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface);
}

public class Test
{
    public static void Main()
    {
        try {
            var enumeratorType = Type.GetTypeFromCLSID(new Guid("BCDE0395-E52F-467C-8E3D-C4579291692E"));
            var enumerator = (IMMDeviceEnumerator)Activator.CreateInstance(enumeratorType);
            IMMDevice device;
            enumerator.GetDefaultAudioEndpoint(0, 1, out device);
            var iid = new Guid("5CDF2C82-841E-4546-9722-0CF74078229A");
            object epvObj;
            device.Activate(ref iid, 1, IntPtr.Zero, out epvObj);
            Console.WriteLine("epvObj is COM: " + Marshal.IsComObject(epvObj));
            Marshal.ReleaseComObject(epvObj);
            Marshal.ReleaseComObject(device);
            Marshal.ReleaseComObject(enumerator);
            Console.WriteLine("Released all");
        } catch(Exception e) { Console.WriteLine(e); }
    }
}
