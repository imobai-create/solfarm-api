import { FastifyRequest, FastifyReply } from 'fastify'
import { UserRole, UserPlan } from '@prisma/client'

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    user: {
      sub: string       // user id
      email: string
      name: string
      role: UserRole
      plan: UserPlan
    }
  }
}
