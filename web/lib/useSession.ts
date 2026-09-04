import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { api, getToken } from "./api";
import type { User } from "./types";

/// Loads the signed-in user, sending anyone without a live session to /signin.
export function useSession({ redirect = true } = {}) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  /// Whether a session token exists at all, resolved on the very first client
  /// render rather than after the fetch. Null on the server, which cannot see
  /// localStorage — a page can treat that as "assume signed out" and serve real
  /// markup to crawlers instead of a skeleton.
  const [hasToken, setHasToken] = useState<boolean | null>(() =>
    typeof window === "undefined" ? null : Boolean(getToken())
  );

  useEffect(() => {
    let cancelled = false;

    /// Where to send them back to after signing in.
    ///
    /// Not `router.asPath`: on a statically optimised dynamic route it is the
    /// template — a literal "/w/[id]" — until the router finishes resolving,
    /// and this effect runs before that. Following an invite link therefore
    /// signed you in and then failed to navigate anywhere. `window.location` is
    /// the real URL from the first client render.
    const here = window.location.pathname + window.location.search;

    async function load() {
      const token = getToken();
      if (!cancelled) setHasToken(Boolean(token));

      if (!token) {
        if (!cancelled) setLoading(false);
        if (redirect) router.replace(`/signin?next=${encodeURIComponent(here)}`);
        return;
      }
      try {
        const res = await api.get<{ user: User }>("/auth/me");
        if (!cancelled) setUser(res.user);
      } catch {
        if (redirect) router.replace(`/signin?next=${encodeURIComponent(here)}`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
    // The current path is intentionally excluded: re-running on every
    // navigation would refetch the session on each screen change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [redirect]);

  return { user, loading, hasToken };
}
