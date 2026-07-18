import { AuthForm } from "@/components/AuthForm";
import { signUpAction } from "@/app/auth/actions";

export default function RegisterPage() {
  return <AuthForm mode="register" action={signUpAction} />;
}
