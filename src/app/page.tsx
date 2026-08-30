import { redirect } from "next/navigation";
import { createClient, getUser } from "@/lib/supabase/server";
import { DEFAULT_COUNCIL_ID } from "@/lib/launch-config";

// "/" jest czystym rozjazdem, bez własnej treści: zalogowany trafia do
// swojej ulubionej rady (albo, gdy jej nie wybrał, do jedynej publicznie
// widocznej), anonimowy — od razu do tej samej publicznej rady. Logowanie
// nie jest tu bramką: dostępne jest jako link w site-header.tsx (prawy
// górny róg), bo przeglądanie samo w sobie nie go wymaga.
//
// Callback OAuth celowo nie powiela tego wyboru — kieruje na "/" i to ten
// rozjazd decyduje. Wcześniej logika ulubionej rady siedziała wyłącznie w
// callbacku, więc działała tylko w chwili logowania: wejście na stronę z już
// aktywną sesją lądowało na mapie.
export default async function Home() {
  const supabase = await createClient();
  const user = await getUser();

  if (!user) {
    redirect(`/rada/${DEFAULT_COUNCIL_ID}`);
  }

  const { data: appUser } = await supabase
    .from("app_user")
    .select("favorite_council_id")
    .eq("id", user.id)
    .maybeSingle();
  redirect(
    appUser?.favorite_council_id
      ? `/rada/${appUser.favorite_council_id}`
      : `/rada/${DEFAULT_COUNCIL_ID}`
  );
}
