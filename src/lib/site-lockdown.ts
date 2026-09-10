/**
 * Serwis wstrzymany dla wszystkich poza właścicielką od 2026-09-10: eSesja.tv
 * (dostawca nagrań, z których serwis korzysta) nie potwierdziła zgody na
 * sposób ich przetwarzania (zob. notatki/mail-esesja-regulamin-nagran-2026-09-02.txt).
 * Do wyjaśnienia dostęp ma wyłącznie to jedno konto — proxy.ts odsyła
 * każdego innego (zalogowanego czy nie) z powrotem na `/`, a strona główna
 * pokazuje im wtedy informację o wyłączeniu zamiast normalnej treści.
 */
export const OWNER_EMAIL = "iwona.rysik@gmail.com";

export function isOwner(email: string | null | undefined) {
  return email === OWNER_EMAIL;
}
