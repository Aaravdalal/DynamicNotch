Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Collections.Generic;

namespace AudioMeter {
    [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IMMDeviceEnumerator {
        [PreserveSig] int EnumAudioEndpoints(int dataFlow, int dwStateMask, out IntPtr ppDevices);
        [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IntPtr ppDevice);
        [PreserveSig] int GetDevice(string pwstrId, out IntPtr ppDevice);
        [PreserveSig] int RegisterEndpointNotificationCallback(IntPtr pClient);
        [PreserveSig] int UnregisterEndpointNotificationCallback(IntPtr pClient);
    }

    [Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B4E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IMMDeviceCollection {
        [PreserveSig] int GetCount(out uint pcDevices);
        [PreserveSig] int Item(uint nDevice, out IntPtr ppDevice);
    }

    [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IMMDevice {
        [PreserveSig] int Activate(ref Guid iid, int dwClsCtx, IntPtr pActivationParams, out IntPtr ppInterface);
        [PreserveSig] int OpenPropertyStore(int stgmAccess, out IntPtr ppProperties);
        [PreserveSig] int GetId(out IntPtr ppstrId);
        [PreserveSig] int GetState(out uint pdwState);
    }

    [Guid("77AA9910-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IAudioSessionManager2 {
        [PreserveSig] int GetSessionEnumerator(out IntPtr ppSessionEnum);
    }

    [Guid("E2F5BB11-0B3D-4234-8152-70414B61E63C"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IAudioSessionEnumerator {
        [PreserveSig] int GetCount(out int pCount);
        [PreserveSig] int GetSession(int SessionCount, out IntPtr ppSessionControl);
    }

    [Guid("F4B1A099-1DD1-4018-A1D2-9B878C2FCCCD"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IAudioSessionControl {
        [PreserveSig] int GetState(out int pRetVal);
        [PreserveSig] int GetDisplayName(out IntPtr ppRetVal);
    }

    [Guid("C02216F6-8C67-4B30-9D7A-7199C668F66B"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IAudioMeterInformation {
        [PreserveSig] int GetPeakValue(out float pfPeak);
    }

    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    class MMDeviceEnumeratorComObject { }

    public class PeakTool {
        private static Guid IID_IAudioMeterInformation = new Guid("C02216F6-8C67-4B30-9D7A-7199C668F66B");
        private static Guid IID_IAudioSessionManager2 = new Guid("77AA9910-1BD6-484F-8BC7-2C654C9A9B6F");

        public static float GetMaxPeak(int dataFlow) {
            float max = 0;
            try {
                var enumerator = (IMMDeviceEnumerator)new MMDeviceEnumeratorComObject();
                IntPtr collectionPtr;
                if (enumerator.EnumAudioEndpoints(dataFlow, 1, out collectionPtr) == 0) {
                    var collection = (IMMDeviceCollection)Marshal.GetTypedObjectForIUnknown(collectionPtr, typeof(IMMDeviceCollection));
                    uint count; collection.GetCount(out count);
                    for (uint i = 0; i < count; i++) {
                        IntPtr devicePtr;
                        if (collection.Item(i, out devicePtr) == 0) {
                            var device = (IMMDevice)Marshal.GetTypedObjectForIUnknown(devicePtr, typeof(IMMDevice));
                            
                            // Check device peak
                            IntPtr dmPtr;
                            if (device.Activate(ref IID_IAudioMeterInformation, 1, IntPtr.Zero, out dmPtr) == 0) {
                                var meter = (IAudioMeterInformation)Marshal.GetTypedObjectForIUnknown(dmPtr, typeof(IAudioMeterInformation));
                                float p; meter.GetPeakValue(out p);
                                if (p > max) max = p;
                                Marshal.Release(dmPtr);
                            }

                            // Also sessions for deeper check
                            IntPtr asmPtr;
                            if (device.Activate(ref IID_IAudioSessionManager2, 1, IntPtr.Zero, out asmPtr) == 0) {
                                var manager = (IAudioSessionManager2)Marshal.GetTypedObjectForIUnknown(asmPtr, typeof(IAudioSessionManager2));
                                IntPtr sePtr;
                                if (manager.GetSessionEnumerator(out sePtr) == 0) {
                                    var se = (IAudioSessionEnumerator)Marshal.GetTypedObjectForIUnknown(sePtr, typeof(IAudioSessionEnumerator));
                                    int sc; se.GetCount(out sc);
                                    for (int j = 0; j < sc; j++) {
                                        IntPtr sPtr;
                                        if (se.GetSession(j, out sPtr) == 0) {
                                            IntPtr miPtr;
                                            if (Marshal.QueryInterface(sPtr, ref IID_IAudioMeterInformation, out miPtr) == 0) {
                                                var mi = (IAudioMeterInformation)Marshal.GetTypedObjectForIUnknown(miPtr, typeof(IAudioMeterInformation));
                                                float p; mi.GetPeakValue(out p);
                                                if (p > max) max = p;
                                                Marshal.Release(miPtr);
                                            }
                                            Marshal.Release(sPtr);
                                        }
                                    }
                                    Marshal.Release(sePtr);
                                }
                                Marshal.Release(asmPtr);
                            }
                            Marshal.Release(devicePtr);
                        }
                    }
                    Marshal.Release(collectionPtr);
                }
            } catch { }
            return max;
        }
    }
}
"@

while ($true) {
    Start-Sleep -Milliseconds 50
    $pRender = [AudioMeter.PeakTool]::GetMaxPeak(0)
    $pCapture = [AudioMeter.PeakTool]::GetMaxPeak(1)
    $vRender = [math]::Round($pRender * 100)
    $vCapture = [math]::Round($pCapture * 100)
    Write-Host "PEAK:$vRender|MIC_PEAK:$vCapture"
}
