using System;
using System.Threading.Tasks;
using Windows.Media.Control;

namespace MediaControlsBinding
{
    class Program
    {
        static void Main(string[] args)
        {
            try
            {
                var manager = GlobalSystemMediaTransportControlsSessionManager.RequestAsync().AsTask().GetAwaiter().GetResult();
                var session = manager.GetCurrentSession();
                
                if (session == null)
                {
                    Console.WriteLine("None");
                    return;
                }

                var playbackInfo = session.GetPlaybackInfo();
                if (playbackInfo.PlaybackStatus != GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing)
                {
                    Console.WriteLine("Paused");
                    return;
                }

                var props = session.TryGetMediaPropertiesAsync().AsTask().GetAwaiter().GetResult();
                Console.WriteLine("Playing|" + props.Artist + "|" + props.Title);
            }
            catch (Exception ex)
            {
                Console.WriteLine("Error|" + ex.Message);
            }
        }
    }
}
