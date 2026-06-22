import { AuthForm } from '@/components/AuthForm';
import { logInAction } from '@/server/actions';

export default function LoginPage() {
  return (
    <AuthForm
      action={logInAction}
      heading="log in"
      blurb="Welcome back. Pick up where you left off."
      submitLabel="log in"
      alt={{ href: '/signup', label: 'need an account? sign up →' }}
    />
  );
}
