import { GoogleSignInButton } from "@/components/google-sign-in-button";

export default function LoginPage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 py-32">
      <h1 className="text-2xl font-semibold">Zaloguj się do Rady</h1>
      <GoogleSignInButton />
    </div>
  );
}
