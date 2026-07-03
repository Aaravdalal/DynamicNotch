using System;
using System.Threading.Tasks;
using Windows.UI.Notifications.Management;
using Windows.UI.Notifications;

class Program {
    static async Task Main(string[] args) {
        try {
            var listener = UserNotificationListener.Current;
            var accessStatus = await listener.RequestAccessAsync();
            Console.WriteLine("Access: " + accessStatus);
            
            if (accessStatus != UserNotificationListenerAccessStatus.Allowed) {
                Console.WriteLine("Access denied.");
                return;
            }

            var notifs = await listener.GetNotificationsAsync(NotificationKinds.Toast);
            Console.WriteLine("Got " + notifs.Count + " notifications");
            foreach (var n in notifs) {
                Console.WriteLine($"App: {n.AppInfo.DisplayInfo.DisplayName}");
            }
        } catch (Exception e) {
            Console.WriteLine("Error: " + e.Message);
        }
    }
}
