import { defineCollection, reference } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

const status = z.enum(["seedling", "growing", "evergreen"]);

const postLocation = z.object({
  region: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  name: z.string().min(1),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

const relatedReference = z.discriminatedUnion("collection", [
  z.object({ collection: z.literal("courses"), entry: reference("courses") }),
  z.object({ collection: z.literal("notes"), entry: reference("notes") }),
  z.object({ collection: z.literal("labs"), entry: reference("labs") }),
  z.object({ collection: z.literal("projects"), entry: reference("projects") }),
  z.object({ collection: z.literal("essays"), entry: reference("essays") }),
]);

const commonFields = {
  title: z.string().min(1),
  description: z.string().min(1),
  publishedAt: z.coerce.date().optional(),
  updatedAt: z.coerce.date(),
  tags: z.array(z.string().min(1)).default([]),
  status: status.default("seedling"),
  draft: z.boolean().default(false),
  related: z.array(relatedReference).default([]),
};

const postFields = {
  ...commonFields,
  location: postLocation.optional(),
};

const courses = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/courses" }),
  schema: z.object(commonFields),
});

const notes = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/notes" }),
  schema: z.object({
    ...postFields,
    course: reference("courses").optional(),
    feed: z.boolean().default(false),
  }),
});

const labs = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/labs" }),
  schema: z.object({
    ...postFields,
    course: reference("courses").optional(),
  }),
});

const projects = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/projects" }),
  schema: z.object({
    ...postFields,
    course: reference("courses"),
  }),
});

const essays = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/essays" }),
  schema: z.object(postFields),
});

export const collections = { courses, notes, labs, projects, essays };
