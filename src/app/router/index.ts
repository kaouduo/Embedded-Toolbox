import { createRouter, createWebHistory } from "vue-router";
import type { RouteRecordRaw } from "vue-router";

/**
 * Routes are grouped by functional module. Views live inside their
 * module (`src/modules/<module>/views`); this file only wires them up.
 */
const routes: RouteRecordRaw[] = [
  {
    path: "/",
    name: "home",
    component: () => import("@/modules/home/views/HomeView.vue"),
    meta: { titleKey: "tools.home" },
  },
  {
    path: "/protocol/modbus",
    name: "protocol-modbus",
    component: () => import("@/modules/protocol/views/ModbusView.vue"),
    meta: { titleKey: "tools.modbus" },
  },
  {
    path: "/communication/serial",
    name: "communication-serial",
    component: () => import("@/modules/communication/views/SerialView.vue"),
    meta: { titleKey: "tools.serial" },
  },
  {
    path: "/communication/tcp-udp",
    name: "communication-tcp-udp",
    component: () => import("@/modules/communication/views/TcpUdpView.vue"),
    meta: { titleKey: "tools.tcpUdp" },
  },
  {
    path: "/converter/number",
    name: "converter-number",
    component: () => import("@/modules/converter/views/NumberConverterView.vue"),
    meta: { titleKey: "tools.numberConverter" },
  },
  {
    path: "/converter/ieee754",
    name: "converter-ieee754",
    component: () => import("@/modules/converter/views/Ieee754View.vue"),
    meta: { titleKey: "tools.ieee754" },
  },
  {
    path: "/converter/endian",
    name: "converter-endian",
    component: () => import("@/modules/converter/views/EndianView.vue"),
    meta: { titleKey: "tools.endian" },
  },
  {
    path: "/calculator/crc",
    name: "calculator-crc",
    component: () => import("@/modules/calculator/views/CrcView.vue"),
    meta: { titleKey: "tools.crc" },
  },
  {
    path: "/calculator/can-bit-timing",
    name: "calculator-can-bit-timing",
    component: () => import("@/modules/calculator/views/CanBitTimingView.vue"),
    meta: { titleKey: "tools.canBitTiming" },
  },
  {
    path: "/calculator/timer",
    name: "calculator-timer",
    component: () => import("@/modules/calculator/views/TimerView.vue"),
    meta: { titleKey: "tools.timer" },
  },
  {
    path: "/image/converter",
    name: "image-converter",
    component: () => import("@/modules/image/views/ImageConverterView.vue"),
    meta: { titleKey: "tools.imageConverter" },
  },
  {
    path: "/color/palette",
    name: "color-palette",
    component: () => import("@/modules/color/views/ColorPaletteView.vue"),
    meta: { titleKey: "tools.colorPalette" },
  },
  {
    path: "/device/manager",
    name: "device-manager",
    component: () => import("@/modules/device/views/DeviceManagerView.vue"),
    meta: { titleKey: "tools.deviceManager" },
  },
  {
    path: "/:pathMatch(.*)*",
    redirect: "/",
  },
];

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
});
