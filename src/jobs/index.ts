import { aiRespondJob } from "./ai/respond";
import { followUpSchedulerJob, followUpSendJob } from "./automation/follow-ups";
import { billingLifecycleJob } from "./billing/lifecycle";
import { expireStaleOrdersJob } from "./orders/expire";
import { paymentConfirmationJob, unpayableOrderJob } from "./payments/notify";
import { processWhatsAppEventJob, whatsappEventSweeperJob } from "./whatsapp/process-event";

export const functions = [
  processWhatsAppEventJob,
  whatsappEventSweeperJob,
  aiRespondJob,
  expireStaleOrdersJob,
  paymentConfirmationJob,
  unpayableOrderJob,
  followUpSchedulerJob,
  followUpSendJob,
  billingLifecycleJob,
];
