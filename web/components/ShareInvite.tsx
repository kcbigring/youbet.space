import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../lib/api";
import { Banner } from "./Layout";

/// The link is the invitation, and the person holding it has to send it. The
/// platform deliberately texts nobody: a message from a friend converts better
/// than one from a shortcode, and it keeps us out of app-to-person messaging.
///
/// So the link is fetched and shown immediately rather than hidden behind a
/// button, and the panel says out loud that sending it is your job.
export function ShareInvite({
  endpoint,
  shareTitle = "youbet.space",
  heading = "Send this to your friends",
}: {
  endpoint: string;
  label?: string;
  shareTitle?: string;
  heading?: string;
}) {
  const [link, setLink] = useState<{ url: string; message: string } | null>(null);
  const [alreadyMember, setAlreadyMember] = useState(false);
  const [copied, setCopied] = useState(false);
  const [shared, setShared] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .post<{ url: string; message: string; alreadyMember?: boolean }>(endpoint, {})
      .then((res) => {
        if (cancelled) return;
        if (res.alreadyMember) setAlreadyMember(true);
        else setLink({ url: res.url, message: res.message });
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Could not create a link");
      });
    return () => {
      cancelled = true;
    };
  }, [endpoint]);

  const copy = useCallback(async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.message);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      setError("Could not copy. Select the link and copy it manually.");
    }
  }, [link]);

  const share = useCallback(async () => {
    if (!link) return;
    try {
      await navigator.share({ title: shareTitle, text: link.message });
      setShared(true);
    } catch {
      // Dismissed the sheet, or the browser refused. Copying still works.
    }
  }, [link, shareTitle]);

  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  if (alreadyMember) return <Banner kind="info">They&rsquo;re already in.</Banner>;

  return (
    <div className="share-panel">
      <b>{heading}</b>
      <p className="small muted" style={{ margin: "6px 0 14px" }}>
        We don&rsquo;t text anyone for you. Paste this into your group chat &mdash; whoever opens
        it can take the other side.
      </p>

      {!link && !error && <div className="skeleton" style={{ height: 46 }} />}

      {link && (
        <>
          <div className="share-link">
            <input readOnly value={link.url} onFocus={(e) => e.target.select()} aria-label="Invite link" />
            <button className="subtle small" onClick={copy}>
              {copied ? "Copied" : "Copy"}
            </button>
          </div>

          {canShare && (
            <button className="block" style={{ marginTop: 10 }} onClick={share}>
              {shared ? "Sent" : "Send to a friend"}
            </button>
          )}

          <p className="small muted share-preview">&ldquo;{link.message}&rdquo;</p>
        </>
      )}

      <Banner>{error}</Banner>
    </div>
  );
}
