import { NotificationChannel } from '@prisma/client';
import { prisma } from '../db';
import { env } from '../env';

type NotifyInput = {
  userId: bigint;
  subject: string;
  body: string;
  channel?: NotificationChannel;
};

/**
 * Stores an in-app notification and "sends" the e-mail. The console transport
 * keeps the flow observable in development; swap it for SMTP/SES in production.
 */
export async function notify({ userId, subject, body, channel = NotificationChannel.email }: NotifyInput) {
  const notification = await prisma.notification.create({
    data: { userId, subject, body, channel },
  });

  if (channel === NotificationChannel.email && env.mailTransport === 'console') {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    // eslint-disable-next-line no-console
    console.info(`[mail] from=${env.mailFrom} to=${user?.email ?? userId} subject="${subject}"\n${body}\n`);
    await prisma.notification.update({
      where: { id: notification.id },
      data: { sentAt: new Date() },
    });
  }

  return notification;
}

export const templates = {
  applicationSubmitted: (grantTitle: string) => ({
    subject: `We received your application for "${grantTitle}"`,
    body:
      `Thank you — your application for "${grantTitle}" has been submitted.\n` +
      'You can follow its status from your dashboard. We will contact you once the review is complete.',
  }),
  statusChanged: (grantTitle: string, status: string, note?: string | null) => ({
    subject: `Update on your application for "${grantTitle}"`,
    body:
      `The status of your application for "${grantTitle}" is now: ${status.replace(/_/g, ' ')}.` +
      (note ? `\n\nNote from the review team:\n${note}` : ''),
  }),
  deadlineReminder: (grantTitle: string, deadline: Date) => ({
    subject: `Reminder: "${grantTitle}" closes on ${deadline.toISOString().slice(0, 10)}`,
    body:
      `Your draft application for "${grantTitle}" has not been submitted yet.\n` +
      `The deadline is ${deadline.toUTCString()}. Submit before then to be considered.`,
  }),
  missingDocuments: (grantTitle: string, missing: string[]) => ({
    subject: `Action needed on your application for "${grantTitle}"`,
    body: `The following items are still missing or incomplete:\n- ${missing.join('\n- ')}`,
  }),
};
