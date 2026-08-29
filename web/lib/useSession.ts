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

    async function load() {
      const token = getToken();
      if (!cancelled) setHasToken(Boolean(token));

      if (!token) {
        if (!cancelled) setLoading(false);
        if (redirect) router.replace(`/signin?next=${encodeURIComponent(router.asPath)}`);
        return;
      }
      try {
        const res = await api.get<{ user: User }>("/auth/me");
        if (!cancelled) setUser(res.user);
      } catch {
        if (redirect) router.replace(`/signin?next=${encodeURIComponent(router.asPath)}`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
    // router.asPath is intentionally excluded: re-running on every navigation
    // would refetch the session on each screen change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [redirect]);

  return { user, loading, hasToken };
}
