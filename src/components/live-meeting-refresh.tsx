"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// The transcription pipeline (whisper/pipeline-advance.mjs) and summary
// imports write straight to Supabase from outside the app — without this,
// a Server Component's data only refreshes on the next full
// navigation/reload, so a newly imported session sits invisible on an
// already-open tab until someone manually refreshes. Subscribes to
// Postgres changes on `meeting` for this term and calls router.refresh()
// to re-run the current page's server-side data fetch when anything
// changes.
export function LiveMeetingRefresh({ termId }: { termId: string }) {
  const router = useRouter();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`meeting-changes-${termId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "meeting",
          filter: `term_id=eq.${termId}`,
        },
        () => {
          // Coalesce bursts (e.g. an import followed by a status update
          // landing within the same second) into a single refresh.
          if (debounceRef.current) clearTimeout(debounceRef.current);
          debounceRef.current = setTimeout(() => router.refresh(), 500);
        }
      )
      .subscribe();

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      supabase.removeChannel(channel);
    };
  }, [termId, router]);

  return null;
}
