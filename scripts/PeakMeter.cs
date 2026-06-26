using System;
using System.Runtime.InteropServices;
using System.Threading;

namespace AudioPeakMeter {
    class Program {
        [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IMMDeviceEnumerator {
            int EnumAudioEndpoints(int dataFlow, int dwStateMask, out IntPtr ppDevices);
            int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice ppDevice);
        }

        [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IMMDevice {
            int Activate(ref Guid iid, int dwClsCtx, IntPtr pActivationParams, [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface);
        }

        [Guid("C02216F6-8C67-4B30-9D7A-7199C668F66B"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IAudioMeterInformation {
            int GetPeakValue(out float pfPeak);
        }

        [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
        class MMDeviceEnumerator { }

        static void Main(string[] args) {
            IAudioMeterInformation meter = null;
            Guid IID_IAudioMeterInformation = new Guid("C02216F6-8C67-4B30-9D7A-7199C668F66B");

            while (true) {
                try {
                    if (meter == null) {
                        var enumerator = (IMMDeviceEnumerator)new MMDeviceEnumerator();
                        IMMDevice device;
                        // flow: eRender (0), role: eMultimedia (1)
                        if (enumerator.GetDefaultAudioEndpoint(0, 1, out device) == 0) {
                            object obj;
                            if (device.Activate(ref IID_IAudioMeterInformation, 1, IntPtr.Zero, out obj) == 0) {
                                meter = (IAudioMeterInformation)obj;
                            }
                        }
                    }

                    if (meter != null) {
                        float peak;
                        if (meter.GetPeakValue(out peak) == 0) {
                            Console.WriteLine("PEAK:" + (int)(peak * 100));
                        } else {
                            meter = null; // Reset on failure
                        }
                    } else {
                        Console.WriteLine("PEAK:0");
                    }
                } catch {
                    meter = null;
                }
                Thread.Sleep(50); // 20Hz updates
            }
        }
    }
}
