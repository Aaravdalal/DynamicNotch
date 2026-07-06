using System;
using System.Threading.Tasks;
using Windows.UI.Notifications.Management;

class Program {
    static async Task Main(string[] args) {
        try {
            var listener = UserNotificationListener.Current;
            var accessStatus = await listener.RequestAccessAsync();
            Console.WriteLine("Access: " + accessStatus);
        } catch(Exception e) {
            Console.WriteLine("Err: " + e.Message);
        }
    }
}
