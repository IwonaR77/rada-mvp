"use client";

import { useState, useTransition } from "react";
import { toggleFavoriteCouncil } from "@/app/rada/[councilId]/actions";

export function FavoriteCouncilButton({
  councilId,
  initialIsFavorite,
}: {
  councilId: string;
  initialIsFavorite: boolean;
}) {
  const [isFavorite, setIsFavorite] = useState(initialIsFavorite);
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    const optimistic = !isFavorite;
    setIsFavorite(optimistic);
    startTransition(async () => {
      const result = await toggleFavoriteCouncil(councilId);
      if (result.error) setIsFavorite(!optimistic);
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      aria-pressed={isFavorite}
      aria-label={
        isFavorite ? "Usuń z ulubionych" : "Dodaj do ulubionych"
      }
      title={isFavorite ? "Usuń z ulubionych" : "Dodaj do ulubionych"}
      className="shrink-0 rounded-full p-1 text-rose-500 transition-transform hover:scale-110 disabled:opacity-50"
    >
      <svg
        viewBox="0 0 24 24"
        width="22"
        height="22"
        fill={isFavorite ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="2"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 20.727c-.29 0-.578-.101-.812-.303C7.99 18.25 3 13.51 3 9.318 3 6.383 5.28 4 8.084 4c1.58 0 3.017.752 3.916 1.958C12.899 4.752 14.336 4 15.916 4 18.72 4 21 6.383 21 9.318c0 4.191-4.99 8.932-8.188 11.106-.234.202-.522.303-.812.303Z"
        />
      </svg>
    </button>
  );
}
