<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { NButton, NInput, NTag, useMessage } from "naive-ui";
import { useI18n } from "vue-i18n";
import { TargetCatalogService, type PackAnalysis, type PackRecord, type TargetCapability } from "@/services/native/target-catalog-service";
import { listSupportedProbes, type ProbeRecord } from "@/services/native/probe-service";
import { pickBinaryFirmware, planBinaryFlash, type BinaryFlashPlan } from "@/services/native/flash-plan-service";

const { t } = useI18n();
const message = useMessage();
const packs = ref<PackRecord[]>([]);
const analyses = ref<PackAnalysis[]>([]);
const probes = ref<ProbeRecord[]>([]);
const query = ref("");
const busy = ref(false);
const selectedId = ref("");
const selectedDeviceName = ref("");
const firmwarePath = ref("");
const startAddress = ref("");
const flashPlan = ref<BinaryFlashPlan | null>(null);
const selected = computed(() => packs.value.find((pack) => pack.id === selectedId.value));
const analysis = computed(() => analyses.value.find((item) => item.packId === selected.value?.id && item.sha256 === selected.value?.sha256));
const selectedDevice = computed(() => selected.value?.devices.find((device) => device.name === selectedDeviceName.value));
const selectedDeviceAnalysis = computed(() => analysis.value?.targets.find((target) => target.name === selectedDeviceName.value));
watch([selectedId, selectedDeviceName, firmwarePath, startAddress], () => { flashPlan.value = null; });
const devices = computed(() => selected.value?.devices.filter((device) =>
  `${device.name} ${device.family}`.toLowerCase().includes(query.value.toLowerCase()),
) ?? []);
function capabilityLabel(capability: TargetCapability): string { return t(`targetCatalog.${capability}`); }
function targetState(name: string, capability: TargetCapability) {
  const result = analysis.value?.targets.find((target) => target.name === name);
  return result ? t(result.ready ? "targetCatalog.ready" : "targetCatalog.invalid") : capabilityLabel(capability);
}
async function refresh() {
  try {
    packs.value = await TargetCatalogService.list();
    analyses.value = await TargetCatalogService.listAnalyses();
    if (!packs.value.some((pack) => pack.id === selectedId.value)) selectedId.value = packs.value[0]?.id ?? "";
  } catch (error) { message.error(error instanceof Error ? error.message : String(error)); }
}
async function analyzeSelected() {
  if (!selected.value) return;
  busy.value = true;
  try {
    const result = await TargetCatalogService.analyze(selected.value);
    analyses.value = [...analyses.value.filter((item) => item.packId !== result.packId || item.sha256 !== result.sha256), result];
    message.success(t("targetCatalog.analyzed", { ready: result.targets.filter((target) => target.ready).length }));
  } catch (error) { message.error(error instanceof Error ? error.message : String(error)); }
  finally { busy.value = false; }
}
async function importPack() {
  busy.value = true;
  try {
    const pack = await TargetCatalogService.pickAndImport();
    if (pack) {
      await refresh();
      selectedId.value = pack.id;
      message.success(t("targetCatalog.imported", { count: pack.devices.length }));
    }
  } catch (error) { message.error(error instanceof Error ? error.message : String(error)); }
  finally { busy.value = false; }
}
onMounted(refresh);
async function refreshProbes() {
  try { probes.value = await listSupportedProbes(); }
  catch (error) { message.error(error instanceof Error ? error.message : String(error)); }
}
async function chooseFirmware() {
  try {
    const path = await pickBinaryFirmware();
    if (path) firmwarePath.value = path;
  } catch (error) { message.error(error instanceof Error ? error.message : String(error)); }
}
async function previewBinaryPlan() {
  if (!selected.value || !selectedDevice.value) return;
  busy.value = true;
  try {
    flashPlan.value = await planBinaryFlash({
      packId: selected.value.id,
      packSha256: selected.value.sha256,
      device: selectedDevice.value.name,
      firmwarePath: firmwarePath.value,
      startAddress: startAddress.value,
    });
  } catch (error) { message.error(error instanceof Error ? error.message : String(error)); }
  finally { busy.value = false; }
}
onMounted(refreshProbes);
</script>

<template>
  <section class="target-catalog">
    <header class="target-catalog__header">
      <div><h1>{{ t("tools.deviceManager") }}</h1><p>{{ t("targetCatalog.description") }}</p></div>
      <NButton type="primary" :loading="busy" @click="importPack">{{ t("targetCatalog.import") }}</NButton>
    </header>
    <section class="target-catalog__probes">
      <div class="target-catalog__probe-heading"><h2>{{ t("targetCatalog.probes") }}</h2><NButton size="small" @click="refreshProbes">{{ t("targetCatalog.refresh") }}</NButton></div>
      <p v-if="!probes.length">{{ t("targetCatalog.noProbes") }}</p>
      <p v-for="probe in probes" :key="`${probe.kind}:${probe.vendorId}:${probe.productId}:${probe.serialNumber}:${probe.interface}`">
        {{ probe.kind }} · {{ probe.name }} · {{ probe.vendorId.toString(16).padStart(4, "0") }}:{{ probe.productId.toString(16).padStart(4, "0") }} · {{ probe.serialNumber || t("targetCatalog.noSerial") }}
        <NTag v-if="!probe.accessible" type="warning">{{ t("targetCatalog.notAccessible") }}</NTag>
      </p>
    </section>
    <div class="target-catalog__body">
      <aside class="target-catalog__packs">
        <h2>{{ t("targetCatalog.packs") }}</h2>
        <p v-if="!packs.length">{{ t("targetCatalog.empty") }}</p>
        <button v-for="pack in packs" :key="pack.id" class="target-catalog__pack" :class="{ selected: pack.id === selectedId }" @click="selectedId = pack.id">
          <strong>{{ pack.vendor }} {{ pack.name }}</strong><span>v{{ pack.version }} · {{ pack.devices.length }} {{ t("targetCatalog.devices") }}</span>
        </button>
      </aside>
      <main class="target-catalog__devices" v-if="selected">
        <h2>{{ selected.vendor }} {{ selected.name }} v{{ selected.version }}</h2>
        <p class="target-catalog__hash">SHA-256: {{ selected.sha256 }}</p>
        <p>{{ t(analysis ? "targetCatalog.validatedNoHardware" : "targetCatalog.notFlashReady") }}</p>
        <NButton :loading="busy" @click="analyzeSelected">{{ t("targetCatalog.analyze") }}</NButton>
        <p v-if="analysis">{{ t("targetCatalog.analysisSummary", { ready: analysis.targets.filter((target) => target.ready).length, total: analysis.targets.length }) }}</p>
        <NInput v-model:value="query" :placeholder="t('targetCatalog.search')" clearable />
        <div v-for="device in devices" :key="device.name" class="target-catalog__device">
          <span><button class="target-catalog__device-name" @click="selectedDeviceName = device.name">{{ device.name }}</button> <small>{{ device.family }} · {{ device.core || t("targetCatalog.coreUnknown") }} · {{ device.memoryRegions.length }} {{ t("targetCatalog.regions") }}</small></span>
          <NTag :type="analysis?.targets.find((target) => target.name === device.name)?.ready ? 'success' : 'warning'">{{ targetState(device.name, device.capability) }}</NTag>
        </div>
        <section v-if="selectedDevice" class="target-catalog__details">
          <h3>{{ selectedDevice.name }} · {{ t("targetCatalog.details") }}</h3>
          <p v-if="selectedDeviceAnalysis?.reason">{{ selectedDeviceAnalysis.reason }}</p>
          <h4>{{ t("targetCatalog.regions") }}</h4>
          <p v-for="region in selectedDevice.memoryRegions" :key="region.id">{{ region.id }}: {{ region.start }} / {{ region.size }} {{ region.access || "" }}</p>
          <h4>{{ t("targetCatalog.algorithms") }}</h4>
          <p v-for="algorithm in selectedDevice.algorithms" :key="algorithm.file">{{ algorithm.file }} · {{ algorithm.start || "?" }} / {{ algorithm.size || "?" }}</p>
          <div v-if="selectedDeviceAnalysis?.ready" class="target-catalog__plan">
            <h4>{{ t("targetCatalog.binaryPlan") }}</h4>
            <NButton size="small" @click="chooseFirmware">{{ t("targetCatalog.chooseBin") }}</NButton>
            <p>{{ firmwarePath || t("targetCatalog.noFirmware") }}</p>
            <NInput v-model:value="startAddress" :placeholder="t('targetCatalog.startAddress')" />
            <NButton :disabled="!firmwarePath || !startAddress" :loading="busy" @click="previewBinaryPlan">{{ t("targetCatalog.previewPlan") }}</NButton>
            <div v-if="flashPlan">
              <p>{{ flashPlan.startAddress }} → {{ flashPlan.endAddressExclusive }} · {{ flashPlan.byteCount }} B</p>
              <p>{{ flashPlan.memoryRegion }} · {{ flashPlan.flashAlgorithm }}</p>
              <p>SHA-256: {{ flashPlan.firmwareSha256 }}</p>
              <p>{{ t("targetCatalog.planOnly") }}</p>
            </div>
          </div>
        </section>
      </main>
    </div>
  </section>
</template>

<style scoped>
.target-catalog { padding: 24px; height: 100%; box-sizing: border-box; }
.target-catalog__header { display: flex; align-items: start; justify-content: space-between; gap: 16px; margin-bottom: 20px; }
.target-catalog__header h1 { margin: 0 0 4px; }
.target-catalog__header p { margin: 0; opacity: .7; }
.target-catalog__probes { margin-bottom: 20px; padding: 12px 16px; border: 1px solid #8885; border-radius: 8px; }
.target-catalog__probe-heading { display: flex; justify-content: space-between; align-items: center; }
.target-catalog__probe-heading h2 { margin: 0; }
.target-catalog__probes p { margin: 6px 0; }
.target-catalog__body { display: grid; grid-template-columns: minmax(220px, 280px) minmax(0, 1fr); gap: 20px; }
.target-catalog__packs, .target-catalog__devices { min-width: 0; }
.target-catalog__pack { display: flex; flex-direction: column; width: 100%; padding: 12px; margin-bottom: 8px; text-align: left; border: 1px solid #8885; border-radius: 8px; background: transparent; color: inherit; cursor: pointer; }
.target-catalog__pack.selected { border-color: #18a058; }
.target-catalog__pack span, .target-catalog__hash, .target-catalog__device small { opacity: .65; font-size: 12px; }
.target-catalog__hash { overflow-wrap: anywhere; }
.target-catalog__device { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 10px 0; border-bottom: 1px solid #8883; }
.target-catalog__device-name { border: 0; background: none; color: inherit; padding: 0; font: inherit; font-weight: 700; cursor: pointer; }
.target-catalog__details { margin-top: 20px; padding: 16px; border: 1px solid #8885; border-radius: 8px; }
.target-catalog__details p { margin: 6px 0; overflow-wrap: anywhere; font-family: monospace; }
.target-catalog__plan { display: grid; gap: 8px; margin-top: 20px; }
@media (max-width: 720px) { .target-catalog__body { grid-template-columns: 1fr; } }
</style>
