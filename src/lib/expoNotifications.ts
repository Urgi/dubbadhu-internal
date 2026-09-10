type NotificationsModule = typeof import('expo-notifications')

let cached: NotificationsModule | null | undefined

/** Load expo-notifications only if the native module is in this binary. */
export function getExpoNotifications(): NotificationsModule | null {
  if (cached !== undefined) return cached
  try {
    // Native debug clients can be older than JS and miss ExpoPushTokenManager.
    cached = require('expo-notifications') as NotificationsModule
    return cached
  } catch (err) {
    console.warn('[expoNotifications] native module unavailable', err)
    cached = null
    return null
  }
}
