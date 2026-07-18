import { AuthForm } from "@/components/AuthForm";
import { signInAction } from "@/app/auth/actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return <AuthForm mode="login" action={signInAction} next={next} />;
}
