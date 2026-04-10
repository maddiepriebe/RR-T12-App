import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  return (
    <div className="min-h-screen bg-navy-950 flex items-center justify-center">
      <div className="flex flex-col items-center gap-8">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-white tracking-tight">
            AREL CAPITAL
          </h1>
          <p className="text-gold-400 text-sm font-medium tracking-widest uppercase mt-1">
            Underwriting Tools
          </p>
        </div>
        <SignUp />
      </div>
    </div>
  );
}
