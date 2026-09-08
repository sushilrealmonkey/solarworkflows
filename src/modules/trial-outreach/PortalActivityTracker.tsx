import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "../../app/AuthProvider";
import { moduleKeyForPath } from "../../app/routes";
import { supabase } from "../../services/supabaseClient";

type ActivityKey = "portal_session_started" | "portal_page_viewed" | "feature_error";

export function PortalActivityTracker() {
  const { profile, status } = useAuth();
  const location = useLocation();
  const sessionIdRef = useRef<string | null>(null);
  const startedForProfileRef = useRef<string | null>(null);
  const recordedPageRef = useRef<string | null>(null);
  const currentPathRef = useRef(location.pathname);

  useEffect(() => {
    currentPathRef.current = location.pathname;
  }, [location.pathname]);

  useEffect(() => {
    if (status !== "ready" || !profile?.company_id) return;
    if (startedForProfileRef.current === profile.id) return;

    const sessionId = resolveSessionId(profile.id);
    sessionIdRef.current = sessionId;
    startedForProfileRef.current = profile.id;
    recordActivity("portal_session_started", profile.id, sessionId, currentPathRef.current);
  }, [profile?.company_id, profile?.id, status]);

  useEffect(() => {
    if (status !== "ready" || !profile?.company_id) return;
    const sessionId = sessionIdRef.current ?? resolveSessionId(profile.id);
    const pageIdentity = `${sessionId}:page:${location.key || location.pathname}`;
    if (recordedPageRef.current === pageIdentity) return;

    recordedPageRef.current = pageIdentity;
    recordActivity("portal_page_viewed", profile.id, pageIdentity, location.pathname);
  }, [location.key, location.pathname, profile?.company_id, profile?.id, status]);

  useEffect(() => {
    if (status !== "ready" || !profile?.company_id) return;
    const recordError = (errorName: string) => {
      const sessionId = sessionIdRef.current ?? resolveSessionId(profile.id);
      recordActivity(
        "feature_error",
        profile.id,
        `${sessionId}:error:${crypto.randomUUID()}`,
        location.pathname,
        { error_name: errorName },
      );
    };
    const onError = (event: ErrorEvent) => recordError(event.error instanceof Error ? event.error.name : "window_error");
    const onUnhandledRejection = (event: PromiseRejectionEvent) => recordError(event.reason instanceof Error ? event.reason.name : "unhandled_rejection");
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, [location.pathname, profile?.company_id, profile?.id, status]);

  return null;
}

function resolveSessionId(profileId: string) {
  const key = `bizlee.portal-session:${profileId}`;
  const existing = window.sessionStorage.getItem(key);
  if (existing) return existing;
  const value = crypto.randomUUID();
  window.sessionStorage.setItem(key, value);
  return value;
}

function recordActivity(
  eventKey: ActivityKey,
  profileId: string,
  clientEventKey: string,
  route: string,
  metadata: Record<string, string> = {},
) {
  if (!supabase) return;
  void supabase.rpc("record_portal_activity", {
    p_event_key: eventKey,
    p_module: moduleKeyForPath(route),
    p_route: route,
    p_client_event_key: clientEventKey,
    p_metadata: metadata,
  }).then(({ error }) => {
    if (error) console.warn("Portal activity was not recorded", { eventKey, profileId, error: error.message });
  });
}
