// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  colorMode: {
    preference: "light",
  },

  css: ["~/assets/css/main.css"],
  devtools: { enabled: true },

  modules: [
    "@nuxt/ui",
    "@pinia/nuxt",
    "@nuxt/image",
    "nuxt-svgo",
    "@nuxtjs/google-fonts",
  ],

  googleFonts: {
    families: {
      Inter: [100, 200, 300, 400, 500, 600, 700, 800],
    },
  },

  pinia: {
    storesDirs: ["./stores/**"],
  },

  image: {
    dir: "assets/images",
    directus: {
      baseURL: "/panel/assets/",
      modifier: {
        withoutEnlargement: true,
      },
    },
  },

  nitro: {
    routeRules: {
      "/panel/**": {
        proxy:
          process.env.NODE_ENV === "production"
            ? "http://directus:8055/**"
            : `${process.env.DIRECTUS_PUBLIC_URL}/**`,
      },
    },
  },

  alias: {
    fs: require.resolve("rollup-plugin-node-builtins"),
  },

  routeRules: {
    "/3d": { ssr: false },
    "/3d/**": { ssr: false },
  },

  compatibilityDate: "2026-05-02",
});
