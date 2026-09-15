<script setup lang="ts">
definePageMeta({
  layout: false,
});

import heroImage from "~/assets/images/hero-image.png";
import IcAction from "~/assets/icons/ic-action.svg";
import IcEye from "~/assets/icons/ic-eye.svg";
import IcEyeCrossed from "~/assets/icons/ic-eye-crossed.svg";
import IcSpinner from "~/assets/icons/ic-spinner.svg";
import { useGeneralSettings, useMapData } from "~/utils";

import type { FormError, FormSubmitEvent } from "#ui/types";

type SigninData = {
  email: string;
  password: string;
};

const { data: mapData } = await useMapData();
const { data: generalSettingsData } = await useGeneralSettings();
const signinData = reactive<SigninData>({ email: "", password: "" });
const generalErrorMessage = ref("");
const showPassword = ref(false);
const isLoading = ref(false);

const validateSigninData = (state: SigninData) => {
  const errors: FormError<keyof SigninData>[] = [];
  if (!state.email) errors.push({ path: "email", message: "Required" });
  if (!state.password) errors.push({ path: "password", message: "Required" });
  return errors;
};
const img = useImage();
const bgImgUrl = computed(() =>
  generalSettingsData.value?.data.public_background
    ? `url('${img(generalSettingsData.value.data.public_background, undefined, {
        provider: "directus",
      })}')`
    : null,
);

const { signin, tryRefresh, getDetailUser } = useAuth();
const handleSignin = async (event: FormSubmitEvent<SigninData>) => {
  generalErrorMessage.value = "";
  isLoading.value = true;
  const { email, password } = event.data;

  try {
    const { data } = await $fetch<{ data: AuthPayload }>("/panel/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password, mode: "cookie" }),
    });
    signin(data.access_token);
    getDetailUser(data.access_token);
    setTimeout(() => {
      tryRefresh();
    }, data.expires - 1000);
    navigateTo("/hero");
  } catch (error) {
    generalErrorMessage.value =
      "Signin information is incorrect. Make sure the email and password is correct and try again.";
    isLoading.value = false;
  }
};
</script>

<template>
  <div class="flex p-6 h-[100vh] grid-cols-2 gap-6">
    <div
      class="w-full h-full rounded-l-[50px] relative px-24 py-10 overflow-hidden bg-cover bg-center"
      :style="{ backgroundImage: `url(${heroImage})` }"
    >
      <!-- radial blur -->
      <!-- <div
        class="absolute w-[1200px] h-[1200px] bg-white/15 -bottom-[600px] -left-[400px] rounded-full blur-2xl z-10"
      ></div> -->
      <div
        class="absolute w-[1200px] h-[1200px] bg-blue-900/60 left-0 top-0"
      ></div>
      <div class="flex flex-col h-[calc(100ch-5rem)] absolute z-10">
        <h1 class="text-xl font-bold text-white font-raleway">Dashboard</h1>
        <div class="flex flex-col justify-center h-full">
          <div class="flex flex-col justify-center space-y-4 py-10">
            <h1
              class="text-6xl lead text-white font-raleway leading-tight font-semibold"
            >
              Geospatial Intelligence<br />for Network Planning.
            </h1>
          </div>
        </div>
      </div>
    </div>
    <div class="w-full p-8 px-36 py-6">
      <div
        class="flex flex-col rounded-lg h-full overflow-y-auto justify-center"
      >
        <div class="space-y-4 mb-6">
          <h1 class="text-xl font-bold text-gray-900 font-raleway">Dashboard</h1>
          <h2 class="font-raleway text-4xl leading-tight">
            Geospatial Intelligence for Network Planning
          </h2>
          <p class="text-sm text-grey-500">
            Sign In to continue your mapping journey with us!
          </p>
        </div>
        <div class="w-full flex">
          <UForm
            ref="formRef"
            :validate="validateSigninData"
            :state="signinData"
            class="flex flex-col space-y-4 mb-7 px-1 w-full"
            @submit="handleSignin"
          >
            <UFormGroup name="email">
              <UInput
                v-model="signinData.email"
                type="email"
                size="xl"
                block
                icon="i-material-symbols:mail-outline"
                placeholder="Email Address"
                class="rounded-[999px]"
                :ui="{
                  rounded: '!rounded-[999px]',
                }"
                :disabled="isLoading"
              />
            </UFormGroup>
            <UFormGroup name="password">
              <UInput
                v-model="signinData.password"
                :type="showPassword ? 'text' : 'password'"
                size="xl"
                icon="i-material-symbols:lock-outline"
                placeholder="Password"
                :ui="{
                  rounded: '!rounded-[999px]',
                }"
                :disabled="isLoading"
              >
                <template #trailing>
                  <button
                    type="button"
                    @click="showPassword = !showPassword"
                    class="pointer-events-auto"
                  >
                    <IcEye v-if="showPassword" class="text-grey-400" />
                    <IcEyeCrossed v-else class="text-grey-400" />
                  </button>
                </template>
              </UInput>
            </UFormGroup>
            <div v-if="generalErrorMessage" class="flex space-x-2 items-center">
              <IcAction class="text-red-500 h-full" />
              <p class="grow text-xs text-red-500">
                {{ generalErrorMessage }}
              </p>
            </div>
            <div></div>
            <UButton
              block
              size="xl"
              type="submit"
              variant="solid"
              label="Sign In"
              class="bg-gradient-to-r from-brand-400 to-brand-500 text-white"
              :ui="{
                rounded: 'rounded-[999px]',
                variant: { solid: '' },
              }"
            >
              <IcSpinner
                class="text-white animate-spin h-6 w-6 p-1"
                :fontControlled="false"
                v-if="isLoading"
              />
            </UButton>
          </UForm>
        </div>
      </div>
    </div>
  </div>
</template>
