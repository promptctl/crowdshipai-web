import { AuthForm } from '@/components/AuthForm';
import { signUpAction } from '@/server/actions';

export default function SignupPage() {
  return (
    <AuthForm
      action={signUpAction}
      heading="sign up"
      blurb="Start building in front of an audience."
      submitLabel="create account"
      alt={{ href: '/login', label: 'already have an account? log in →' }}
    />
  );
}
