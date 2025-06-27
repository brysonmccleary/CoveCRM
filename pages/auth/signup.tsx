// pages/auth/signup.tsx
import React from "react";
import { useForm } from "react-hook-form";
import axios from "axios";

interface SignUpForm {
  email: string;
  password: string;
}

export default function SignUp() {
  const { register, handleSubmit } = useForm<SignUpForm>();
  const onSubmit = async (data: SignUpForm) => {
    try {
      await axios.post("/api/auth/signup", data);
      alert("✅ Registered—please sign in.");
      window.location.href = "/auth/signin";
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : (error as any)?.response?.data?.error || String(error);
      alert("❌ Signup failed: " + message);
    }
  };

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="max-w-md mx-auto p-4 space-y-4"
    >
      <h1 className="text-2xl font-bold">Sign Up</h1>

      <div>
        <label className="block mb-1">Email</label>
        <input
          {...register("email", { required: true })}
          type="email"
          placeholder="you@example.com"
          className="w-full p-2 border rounded"
          required
        />
      </div>

      <div>
        <label className="block mb-1">Password</label>
        <input
          {...register("password", { required: true })}
          type="password"
          placeholder="••••••••"
          className="w-full p-2 border rounded"
          required
        />
      </div>

      <button
        type="submit"
        className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700 transition"
      >
        Sign Up
      </button>
    </form>
  );
}

