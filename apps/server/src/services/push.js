import webPush from 'web-push';
import { getConfig } from '../db/index.js';

export function initWebPush(db) {
  const config = getConfig(db);
  if (config.VAPID_PUBLIC_KEY && config.VAPID_PRIVATE_KEY) {
    webPush.setVapidDetails(
      'mailto:admin@foodrescue.org',
      config.VAPID_PUBLIC_KEY,
      config.VAPID_PRIVATE_KEY
    );
  }
}

export async function sendPushNotification(db, userId, payload) {
  try {
    const subs = db.prepare('SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?').all(userId);
    const deleteSub = db.prepare('DELETE FROM push_subscriptions WHERE id = ?');

    for (const sub of subs) {
      const pushConfig = {
        endpoint: sub.endpoint,
        keys: {
          p256dh: sub.p256dh,
          auth: sub.auth
        }
      };

      try {
        await webPush.sendNotification(pushConfig, JSON.stringify(payload));
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          // Subscription expired or gone, delete it
          deleteSub.run(sub.id);
        } else {
          console.warn(`[web-push] Failed to send push to user ${userId}:`, err.message || err);
        }
      }
    }
  } catch (err) {
    console.warn(`[web-push] Error processing push for user ${userId}:`, err.message || err);
  }
}
