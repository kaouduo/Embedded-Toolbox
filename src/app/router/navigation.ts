/**
 * Sidebar navigation tree. Leaf nodes reference route names defined in
 * `src/app/router/index.ts`. Kept separate from the route table so the
 * menu structure (groups, order, icons) can evolve independently.
 */
export interface NavItem {
  key: string;
  labelKey: string;
  icon?: string;
  routeName?: string;
  children?: NavItem[];
}

export const navigation: NavItem[] = [
  { key: "home", labelKey: "navigation.home", icon: "home", routeName: "home" },
  {
    key: "protocol",
    labelKey: "navigation.protocol",
    icon: "protocol",
    children: [{ key: "protocol-modbus", labelKey: "tools.modbus", routeName: "protocol-modbus" }],
  },
  {
    key: "communication",
    labelKey: "navigation.communication",
    icon: "communication",
    children: [
      { key: "communication-serial", labelKey: "tools.serial", routeName: "communication-serial" },
      {
        key: "communication-tcp-udp",
        labelKey: "tools.tcpUdp",
        routeName: "communication-tcp-udp",
      },
    ],
  },
  {
    key: "converter",
    labelKey: "navigation.converter",
    icon: "converter",
    children: [
      { key: "converter-number", labelKey: "tools.numberConverter", routeName: "converter-number" },
      { key: "converter-ieee754", labelKey: "tools.ieee754", routeName: "converter-ieee754" },
      { key: "converter-endian", labelKey: "tools.endian", routeName: "converter-endian" },
    ],
  },
  {
    key: "calculator",
    labelKey: "navigation.calculator",
    icon: "calculator",
    children: [
      { key: "calculator-crc", labelKey: "tools.crc", routeName: "calculator-crc" },
      {
        key: "calculator-can-bit-timing",
        labelKey: "tools.canBitTiming",
        routeName: "calculator-can-bit-timing",
      },
      { key: "calculator-timer", labelKey: "tools.timer", routeName: "calculator-timer" },
    ],
  },
  {
    key: "image",
    labelKey: "navigation.image",
    icon: "image",
    children: [
      { key: "image-converter", labelKey: "tools.imageConverter", routeName: "image-converter" },
    ],
  },
  {
    key: "color",
    labelKey: "navigation.color",
    icon: "color",
    children: [
      { key: "color-palette", labelKey: "tools.colorPalette", routeName: "color-palette" },
    ],
  },
  {
    key: "device",
    labelKey: "navigation.device",
    icon: "device",
    children: [
      { key: "device-manager", labelKey: "tools.deviceManager", routeName: "device-manager" },
    ],
  },
];
