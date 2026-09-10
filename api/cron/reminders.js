import { deliverReminders, expireTemporaryRecords } from '../../server/server.js';

export default async function remindersCron(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    await deliverReminders();
    expireTemporaryRecords();
    res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Reminder cron failed:', error);
    res.status(500).json({ error: 'Reminder processing failed.' });
  }
}
