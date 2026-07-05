/* eslint-disable @typescript-eslint/no-explicit-any */
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "@prisma/client";

let prismaInstance: PrismaClient | null = null;

// Proxy intercepts property accesses to lazy-initialize PrismaClient at runtime
export const prisma = new Proxy({} as PrismaClient, {
  get(target, prop, receiver) {
    // If a built-in symbol or standard promise/framework metadata is read, do not trigger database instantiation
    if (
      typeof prop === "symbol" ||
      prop === "then" ||
      prop === "constructor" ||
      prop === "toJSON" ||
      prop === "$$typeof"
    ) {
      return Reflect.get(target, prop, receiver);
    }

    // Bypass database instantiation during Next.js static build phase to prevent freezing build-time local credentials
    if (process.env.NEXT_PHASE === "phase-production-build") {
      return Reflect.get(target, prop, receiver);
    }

    if (!prismaInstance) {
      const connectionString = process.env.DATABASE_URL;
      
      if (!connectionString || connectionString === "undefined") {
        throw new Error("DATABASE_URL environment variable is missing at runtime!");
      }
      
      // In Prisma 7, PrismaNeon accepts the connection config options directly
      const adapter = new PrismaNeon({ connectionString });
      
      prismaInstance = new PrismaClient({ adapter });
    }
    
    return Reflect.get(prismaInstance, prop, receiver);
  }
});
