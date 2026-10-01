<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { NButton, NCheckbox, NInput, NInputNumber, NTag, useMessage } from "naive-ui";
import { useI18n } from "vue-i18n";
import { TargetCatalogService, type PackAnalysis, type PackRecord, type TargetCapability } from "@/services/native/target-catalog-service";
import { attachProbeSession, disconnectProbeSession, haltProbeSession, inspectProbeTarget, listSupportedProbes, probeSessionStatus, readProbeRam, resumeProbeSession, testTargetConnection, type ProbeConnectionResult, type ProbeRecord, type ProbeSessionInfo, type RamReadResult, type TargetIdentityResult } from "@/services/native/probe-service";
import { pickBinaryFirmware, planBinaryFlash, programBinary, type BinaryFlashPlan, type BinaryProgramResult } from "@/services/native/flash-plan-service";

const { t } = useI18n();
const message = useMessage();
const packs = ref<PackRecord[]>([]);
const analyses = ref<PackAnalysis[]>([]);
const probes = ref<ProbeRecord[]>([]);
const selectedProbeIndex = ref<number | null>(null);
const selectedProbe = computed(() => selectedProbeIndex.value === null ? undefined : probes.value[selectedProbeIndex.value]);
const speedKhz = ref(1800);
const connectionResult = ref<ProbeConnectionResult | null>(null);
const session = ref<ProbeSessionInfo | null>(null);
const targetIdentity = ref<TargetIdentityResult | null>(null);
let unmounted = false;
const ramRead = ref<RamReadResult | null>(null);
const ramAddress = ref("0x20000000");
const ramLength = ref(64);
const query = ref("");
const busy = ref(false);
const selectedId = ref("");
const selectedDeviceName = ref("");
const firmwarePath = ref("");
const startAddress = ref("");
const flashPlan = ref<BinaryFlashPlan | null>(null);
const programResult = ref<BinaryProgramResult | null>(null);
const confirmedPart = ref(false);
const selected = computed(() => packs.value.find((pack) => pack.id === selectedId.value));
const analysis = computed(() => analyses.value.find((item) => item.packId === selected.value?.id && item.sha256 === selected.value?.sha256));
const selectedDevice = computed(() => selected.value?.devices.find((device) => device.name === selectedDeviceName.value));
const selectedDeviceAnalysis = computed(() => analysis.value?.targets.find((target) => target.name === selectedDeviceName.value));
const suggestedAddress = computed(() => selectedDevice.value?.algorithms.find((item) => item.default && item.start)?.start
  ?? selectedDevice.value?.algorithms.find((item) => item.start)?.start ?? null);
const nextStep = computed(() => {
  if (!packs.value.length) return "nextImport";
  if (!analysis.value) return "nextValidate";
  if (!selectedDevice.value) return "nextTarget";
  if (!selectedDeviceAnalysis.value?.ready) return "nextUnsupported";
  if (!firmwarePath.value || !startAddress.value) return "nextFirmware";
  if (!flashPlan.value) return "nextPlan";
  if (!selectedProbe.value?.accessible || !session.value) return "nextProbe";
  if (!targetIdentity.value) return "nextIdentity";
  if (!targetIdentity.value.flashCompatible) return "nextMismatch";
  if (programResult.value?.verified) return "nextVerified";
  return selectedDevice.value.name.startsWith("STM32F407ZG") ? "nextProgram" : "nextProgramBlocked";
});
watch([selectedId, selectedDeviceName, firmwarePath, startAddress], () => {
  flashPlan.value = null;
  programResult.value = null;
  confirmedPart.value = false;
});
watch([selectedId, selectedDeviceName, selectedProbeIndex], () => { connectionResult.value = null; });
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
  if (session.value || busy.value) return;
  busy.value = true;
  try {
    const pack = await TargetCatalogService.pickAndImport();
    if (pack) {
      await refresh();
      selectedId.value = pack.id;
      message.success(t("targetCatalog.imported", { count: pack.devices.length }));
      const result = await TargetCatalogService.analyze(pack);
      analyses.value = [...analyses.value.filter((item) => item.packId !== result.packId || item.sha256 !== result.sha256), result];
      message.success(t("targetCatalog.analyzed", { ready: result.targets.filter((target) => target.ready).length }));
    }
  } catch (error) { message.error(error instanceof Error ? error.message : String(error)); }
  finally { busy.value = false; }
}
onMounted(refresh);
async function refreshProbes() {
  try { probes.value = await listSupportedProbes(); selectedProbeIndex.value = null; }
  catch (error) { message.error(error instanceof Error ? error.message : String(error)); }
}
async function testConnection() {
  if (!selected.value || !selectedDevice.value || !selectedProbe.value || speedKhz.value === null) return;
  busy.value = true;
  try {
    connectionResult.value = await testTargetConnection({
      probe: selectedProbe.value,
      packId: selected.value.id,
      sha256: selected.value.sha256,
      device: selectedDevice.value.name,
      speedKhz: speedKhz.value,
    });
  } catch (error) { message.error(error instanceof Error ? error.message : String(error)); }
  finally { busy.value = false; }
}
async function attachSession() {
  if (session.value || busy.value || !selected.value || !selectedDevice.value || !selectedProbe.value || speedKhz.value === null) return;
  busy.value = true;
  try {
    const attached = await attachProbeSession({
      probe: selectedProbe.value,
      packId: selected.value.id,
      sha256: selected.value.sha256,
      device: selectedDevice.value.name,
      speedKhz: speedKhz.value,
    });
    if (unmounted) {
      await disconnectProbeSession(attached.sessionId);
      return;
    }
    session.value = attached;
    targetIdentity.value = null;
    programResult.value = null;
    ramRead.value = null;
  } catch (error) { if (!unmounted) message.error(error instanceof Error ? error.message : String(error)); }
  finally { busy.value = false; }
}
async function disconnectSession() {
  if (!session.value) return;
  busy.value = true;
  try {
    await disconnectProbeSession(session.value.sessionId);
    session.value = null;
    targetIdentity.value = null;
    confirmedPart.value = false;
    ramRead.value = null;
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error));
  }
  finally { busy.value = false; }
}
async function haltSession() {
  if (!session.value) return;
  busy.value = true;
  try { session.value = await haltProbeSession(session.value.sessionId); }
  catch (error) { message.error(error instanceof Error ? error.message : String(error)); }
  finally { busy.value = false; }
}
async function inspectTarget() {
  if (!session.value) return;
  busy.value = true;
  try { targetIdentity.value = await inspectProbeTarget(session.value.sessionId); }
  catch (error) { targetIdentity.value = null; message.error(error instanceof Error ? error.message : String(error)); }
  finally { busy.value = false; }
}
async function resumeSession() {
  if (!session.value) return;
  busy.value = true;
  try { session.value = await resumeProbeSession(session.value.sessionId); }
  catch (error) { message.error(error instanceof Error ? error.message : String(error)); }
  finally { busy.value = false; }
}
function parseAddress(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  return Number.isInteger(value) && value >= 0 ? value : null;
}
async function readRam() {
  if (!session.value) return;
  const address = parseAddress(ramAddress.value);
  if (address === null || ramLength.value === null || ramLength.value < 1) {
    message.error(t("targetCatalog.invalidRamArgs"));
    return;
  }
  busy.value = true;
  try {
    ramRead.value = await readProbeRam({ sessionId: session.value.sessionId, address, length: ramLength.value });
    session.value = { ...session.value, coreHalted: ramRead.value.coreHalted };
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error));
    try { session.value = await probeSessionStatus(session.value.sessionId); }
    catch (statusError) { message.error(statusError instanceof Error ? statusError.message : String(statusError)); }
  }
  finally { busy.value = false; }
}
function formatRamBytes(result: RamReadResult): string {
  return result.data.map((byte) => byte.toString(16).padStart(2, "0")).join(" ");
}
onBeforeUnmount(() => {
  unmounted = true;
  if (session.value) disconnectProbeSession(session.value.sessionId).catch(() => {});
});
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
async function executeBinaryPlan() {
  if (!session.value || !flashPlan.value || !targetIdentity.value?.flashCompatible || !confirmedPart.value || busy.value) return;
  busy.value = true;
  try {
    programResult.value = await programBinary({
      sessionId: session.value.sessionId,
      firmwarePath: firmwarePath.value,
      startAddress: flashPlan.value.startAddress,
      expectedSha256: flashPlan.value.firmwareSha256,
      confirmedPart: confirmedPart.value,
    });
    session.value = await probeSessionStatus(session.value.sessionId);
    message.success(t("targetCatalog.programVerified"));
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error));
    try { session.value = await probeSessionStatus(session.value.sessionId); } catch { /* retain the error above */ }
  } finally { busy.value = false; }
}
onMounted(refreshProbes);
</script>

<template>
  <section class="target-catalog">
    <header class="target-catalog__header">
      <div><h1>{{ t("tools.firmwareProgrammer") }}</h1><p>{{ t("targetCatalog.description") }}</p></div>
      <NButton type="primary" :disabled="!!session || busy" :loading="busy" @click="importPack">{{ t("targetCatalog.import") }}</NButton>
    </header>
    <section class="target-catalog__workflow">
      <h2>{{ t("targetCatalog.workflow") }}</h2>
      <ol>
        <li>{{ t("targetCatalog.stepPack") }}</li>
        <li>{{ t("targetCatalog.stepTarget") }}</li>
        <li>{{ t("targetCatalog.stepFirmware") }}</li>
        <li>{{ t("targetCatalog.stepProbe") }}</li>
        <li>{{ t("targetCatalog.stepReview") }}</li>
      </ol>
      <p role="status">{{ t(`targetCatalog.${nextStep}`) }}</p>
    </section>
    <section class="target-catalog__probes">
      <div class="target-catalog__probe-heading"><h2>{{ t("targetCatalog.probes") }}</h2><NButton size="small" @click="refreshProbes">{{ t("targetCatalog.refresh") }}</NButton></div>
      <p v-if="!probes.length">{{ t("targetCatalog.noProbes") }}</p>
      <button v-for="(probe, index) in probes" :key="`${probe.kind}:${probe.vendorId}:${probe.productId}:${probe.serialNumber}:${probe.interface}`" class="target-catalog__probe" :class="{ selected: selectedProbeIndex === index }" @click="selectedProbeIndex = index">
        {{ probe.kind }} · {{ probe.name }} · {{ probe.vendorId.toString(16).padStart(4, "0") }}:{{ probe.productId.toString(16).padStart(4, "0") }} · {{ probe.serialNumber || t("targetCatalog.noSerial") }}
        <NTag v-if="!probe.accessible" type="warning">{{ t("targetCatalog.notAccessible") }}</NTag>
      </button>
    </section>
    <div class="target-catalog__body">
      <aside class="target-catalog__packs">
        <h2>{{ t("targetCatalog.packs") }}</h2>
        <p v-if="!packs.length">{{ t("targetCatalog.empty") }}</p>
        <button v-for="pack in packs" :key="pack.id" class="target-catalog__pack" :class="{ selected: pack.id === selectedId }" :disabled="!!session || busy" @click="selectedId = pack.id">
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
          <span><button class="target-catalog__device-name" :disabled="!!session || busy" @click="selectedDeviceName = device.name">{{ device.name }}</button> <small>{{ device.family }} · {{ device.core || t("targetCatalog.coreUnknown") }} · {{ device.memoryRegions.length }} {{ t("targetCatalog.regions") }}</small></span>
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
            <h4>{{ t("targetCatalog.connectionTest") }}</h4>
            <p>{{ t("targetCatalog.connectionTestNote") }}</p>
            <NInputNumber v-model:value="speedKhz" :min="100" :max="10000" :step="100" />
            <NButton :disabled="!selectedProbe?.accessible" :loading="busy" @click="testConnection">{{ t("targetCatalog.testConnection") }}</NButton>
            <p v-if="connectionResult">{{ connectionResult.probeKind }} · {{ connectionResult.targetName }} · {{ connectionResult.coreTypes.join(", ") }} · {{ connectionResult.voltage ?? "?" }} V · {{ t("targetCatalog.identityUnverified") }}</p>
            <h4>{{ t("targetCatalog.session") }}</h4>
            <p>{{ t("targetCatalog.sessionNote") }}</p>
            <div v-if="!session" class="target-catalog__session-actions">
              <NButton type="primary" :disabled="!selectedProbe?.accessible" :loading="busy" @click="attachSession">{{ t("targetCatalog.connect") }}</NButton>
            </div>
            <div v-else class="target-catalog__session">
              <p>{{ session.sessionId }} · {{ session.probeKind }} {{ session.probeSerial || "" }} · {{ session.targetName }} · {{ session.coreTypes.join(", ") }} · {{ session.speedKhz }} kHz · {{ session.voltage ?? "?" }} V</p>
              <p><NTag :type="session.coreHalted ? 'warning' : 'success'">{{ session.coreHalted ? t("targetCatalog.halted") : t("targetCatalog.running") }}</NTag> <span>{{ t("targetCatalog.identityUnverified") }}</span></p>
              <div class="target-catalog__session-actions">
                <NButton size="small" :loading="busy" @click="inspectTarget">{{ t("targetCatalog.inspectTarget") }}</NButton>
                <NButton size="small" :disabled="session.coreHalted" :loading="busy" @click="haltSession">{{ t("targetCatalog.halt") }}</NButton>
                <NButton size="small" :disabled="!session.coreHalted" :loading="busy" @click="resumeSession">{{ t("targetCatalog.resume") }}</NButton>
                <NButton size="small" type="error" :loading="busy" @click="disconnectSession">{{ t("targetCatalog.disconnect") }}</NButton>
              </div>
              <p v-if="targetIdentity">{{ t("targetCatalog.identityResult", { id: targetIdentity.deviceId, size: targetIdentity.flashKib }) }} · {{ t(targetIdentity.flashCompatible ? "targetCatalog.flashCompatible" : "targetCatalog.flashMismatch") }} · {{ t("targetCatalog.exactPartUnverified") }}</p>
              <div class="target-catalog__ram">
                <NInput v-model:value="ramAddress" :placeholder="t('targetCatalog.ramAddress')" style="max-width: 220px" />
                <NInputNumber v-model:value="ramLength" :min="1" :max="4096" style="max-width: 140px" />
                <NButton size="small" :loading="busy" @click="readRam">{{ t("targetCatalog.readRam") }}</NButton>
              </div>
              <p v-if="ramRead" class="target-catalog__ram-dump">{{ ramRead.address }}: {{ formatRamBytes(ramRead) }}</p>
            </div>
            <h4>{{ t("targetCatalog.binaryPlan") }}</h4>
            <NButton size="small" @click="chooseFirmware">{{ t("targetCatalog.chooseBin") }}</NButton>
            <p>{{ firmwarePath || t("targetCatalog.noFirmware") }}</p>
            <div v-if="suggestedAddress && !startAddress" class="target-catalog__address-hint">
              <span>{{ t("targetCatalog.suggestedAddress", { address: suggestedAddress }) }}</span>
              <NButton size="tiny" @click="startAddress = suggestedAddress">{{ t("targetCatalog.useAddress") }}</NButton>
            </div>
            <NInput v-model:value="startAddress" :placeholder="t('targetCatalog.startAddress')" />
            <NButton :disabled="!firmwarePath || !startAddress" :loading="busy" @click="previewBinaryPlan">{{ t("targetCatalog.previewPlan") }}</NButton>
            <div v-if="flashPlan">
              <p>{{ flashPlan.startAddress }} → {{ flashPlan.endAddressExclusive }} · {{ flashPlan.byteCount }} B</p>
              <p>{{ t("targetCatalog.erasePreview", { start: flashPlan.eraseStartAddress, end: flashPlan.eraseEndAddressExclusive, count: flashPlan.eraseSectorCount }) }}</p>
              <p>{{ flashPlan.memoryRegion }} · {{ flashPlan.flashAlgorithm }}</p>
              <p>SHA-256: {{ flashPlan.firmwareSha256 }}</p>
              <p>{{ t("targetCatalog.planOnly") }}</p>
              <template v-if="session && selectedDevice.name.startsWith('STM32F407ZG')">
                <p>{{ t("targetCatalog.programNotice") }}</p>
                <NCheckbox v-model:checked="confirmedPart">{{ t("targetCatalog.confirmPart") }}</NCheckbox>
                <NButton type="error" :disabled="!targetIdentity?.flashCompatible || !confirmedPart || busy" :loading="busy" @click="executeBinaryPlan">{{ t("targetCatalog.programAndVerify") }}</NButton>
                <p v-if="programResult?.verified">{{ t("targetCatalog.programVerified") }} · {{ programResult.byteCount }} B · SHA-256: {{ programResult.firmwareSha256 }}</p>
              </template>
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
.target-catalog__workflow { padding: 12px 16px; margin-bottom: 20px; border: 1px solid #8885; border-radius: 8px; }
.target-catalog__workflow h2 { margin: 0 0 8px; }
.target-catalog__workflow ol { margin: 0; padding-left: 22px; }
.target-catalog__workflow p { margin: 10px 0 0; font-weight: 600; }
.target-catalog__address-hint { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.target-catalog__probes { margin-bottom: 20px; padding: 12px 16px; border: 1px solid #8885; border-radius: 8px; }
.target-catalog__probe-heading { display: flex; justify-content: space-between; align-items: center; }
.target-catalog__probe-heading h2 { margin: 0; }
.target-catalog__probes p { margin: 6px 0; }
.target-catalog__probe { display: block; width: 100%; margin: 6px 0; padding: 6px; text-align: left; border: 1px solid #8885; border-radius: 6px; background: transparent; color: inherit; cursor: pointer; }
.target-catalog__probe.selected { border-color: #18a058; }
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
.target-catalog__session { display: grid; gap: 8px; }
.target-catalog__session-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.target-catalog__ram { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.target-catalog__ram-dump { font-family: monospace; overflow-wrap: anywhere; }
@media (max-width: 720px) { .target-catalog__body { grid-template-columns: 1fr; } }
</style>
