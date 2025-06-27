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
    await axios.post("/api/auth/signup", data);
    alert("✅ Registered—please sign in.");
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="max-w-md mx-auto p-4">
      <h1 className="text-2xl mb-4">Sign Up</h1>
      <input
        {...register("email")}
        placeholder="Email"
        className="w-full mb-2 p-2 border rounded"
      />
      <input
        {...register("password")}
        type="password"
        placeholder="Password"
        className="w-full mb-4 p-2 border rounded"
      />
      <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded">
        Sign Up
      </button>
    </form>
  );
}

