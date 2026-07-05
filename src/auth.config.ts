import GitHub from "next-auth/providers/github";
import type { NextAuthConfig } from "next-auth";

export const authConfig = {
  providers: [
    GitHub({
      clientId: process.env.AUTH_GITHUB_ID,
      clientSecret: process.env.AUTH_GITHUB_SECRET,
      authorization: {
        params: {
          scope: "repo admin:repo_hook",
        },
      },
    }),
  ],
  pages: {
    signIn: "/login",
  },
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const isProtectedRoute = nextUrl.pathname.startsWith("/dashboard") || nextUrl.pathname.startsWith("/api/repos");
      if (isProtectedRoute) {
        if (isLoggedIn) return true;
        return false; // Redirects to the login page specified in pages.signIn
      }
      return true;
    },
  },
} satisfies NextAuthConfig;
