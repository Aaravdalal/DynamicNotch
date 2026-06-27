using System;
using System.Threading.Tasks;
using Windows.Media.Control;

class SmtcMonitor {
    static void Main(string[] args) {
        MainAsync().GetAwaiter().GetResult();
    }

    static async Task MainAsync() {
        var manager = await GlobalSystemMediaTransportControlsSessionManager.RequestAsync();
        var session = manager.GetCurrentSession();
        if (session != null) {
            var mediaProperties = await session.TryGetMediaPropertiesAsync();
            var timeline = session.GetTimelineProperties();
            Console.WriteLine(string.Format("Title: {0}, Artist: {1}", mediaProperties.Title, mediaProperties.Artist));
            Console.WriteLine(string.Format("Position: {0}, End: {1}", timeline.Position.TotalSeconds, timeline.EndTime.TotalSeconds));
        } else {
            Console.WriteLine("No active session");
        }
    }
}
