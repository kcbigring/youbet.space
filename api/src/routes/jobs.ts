import { Router } from "express";
import { asyncHandler } from "../lib/http";
import { requireScheduler } from "../lib/scheduler";
import { findDueReminders, recordReminders } from "../lib/reminders";
import { dispatchPending } from "../lib/notify";

const router = Router();

/// Endpoints driven by Cloud Scheduler rather than by a person.
///
/// Authenticated by the OIDC identity Google signs for Cloud Scheduler. The
/// admin key still works for triggering a run by hand.
router.use(requireScheduler);

/// Hourly. Finds everyone who owes an attestation, records the nudge that is
/// due, then delivers whatever is undelivered.
///
/// Hourly rather than daily on purpose: the plan places reminders at T+24h and
/// T+48h inside a 72-hour window, and a daily run would drift a reminder by up
/// to a day — long enough to land after the deadline it was warning about.
router.post(
  "/reminders",
  asyncHandler(async (_req, res) => {
    const due = await findDueReminders();
    const recorded = await recordReminders(due);
    const dispatched = await dispatchPending();

    res.json({
      ok: true,
      due: due.length,
      recorded: recorded.created,
      ...dispatched,
    });
  })
);

/// Delivery on its own, for retrying a batch that failed to send.
router.post(
  "/notifications/dispatch",
  asyncHandler(async (_req, res) => {
    res.json({ ok: true, ...(await dispatchPending()) });
  })
);

export default router;
