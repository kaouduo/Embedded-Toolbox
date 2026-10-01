<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { NButton, NInput, NInputNumber, NPopconfirm, NSelect, NTag, useMessage } from "naive-ui";
import { useI18n } from "vue-i18n";
import { TargetCatalogService, type PackAnalysis, type PackRecord } from "@/services/native/target-catalog-service";
import { attachProbeSession, disconnectProbeSession, haltProbeSession, listSupportedProbes, probeSessionStatus, readProbeRam, resumeProbeSession, type ProbeRecord, type ProbeSessionInfo, type RamReadResult } from "@/services/native/probe-service";
import { eraseInternalFlash, pickBinaryFirmware, planBinaryFlash, programBinary, type BinaryFlashPlan, type BinaryProgramResult } from "@/services/native/flash-plan-service";

const { t } = useI18n();
const message = useMessage();
const packs = ref<PackRecord[]>([]);
const analyses = ref<PackAnalysis[]>([]);
const probes = ref<ProbeRecord[]>([]);
const probeKind = ref<"ST-Link" | "CMSIS-DAP">("ST-Link");
const selectedProbeIndex = ref<number | null>(null);
const selectedProbe = computed(() => selectedProbeIndex.value === null ? undefined : probes.value[selectedProbeIndex.value]?.kind === probeKind.value ? probes.value[selectedProbeIndex.value] : undefined);
const speedKhz = ref(1800);
const session = ref<ProbeSessionInfo | null>(null);
let unmounted = false;
const ramRead = ref<RamReadResult | null>(null);
const ramAddress = ref("0x20000000");
const ramLength = ref(64);
const busy = ref(false);
const selectedId = ref("");
const selectedDeviceName = ref("");
const firmwarePath = ref("");
const startAddress = ref("0x08000000");
const isBin = computed(() => firmwarePath.value.toLowerCase().endsWith(".bin"));
const flashPlan = ref<BinaryFlashPlan | null>(null);
const planning = ref(false);
const planError = ref("");
let planTimer: ReturnType<typeof setTimeout> | undefined;
let planGeneration = 0;
const programResult = ref<BinaryProgramResult | null>(null);
const selected = computed(() => packs.value.find((pack) => pack.id === selectedId.value));
const analysis = computed(() => analyses.value.find((item) => item.packId === selected.value?.id && item.sha256 === selected.value?.sha256));
const selectedDevice = computed(() => selected.value?.devices.find((device) => device.name === selectedDeviceName.value));
const selectedDeviceAnalysis = computed(() => analysis.value?.targets.find((target) => target.name === selectedDeviceName.value));
const packOptions = computed(() => packs.value.map((pack) => ({ label: `${pack.vendor} ${pack.name} · v${pack.version}`, value: pack.id })));
const deviceOptions = computed(() => selected.value?.devices.filter((device) => analysis.value?.targets.some((target) => target.name === device.name && target.ready)).map((device) => ({ label: device.name, value: device.name })) ?? []);
const probeOptions = computed(() => probes.value.flatMap((probe, index) => probe.kind === probeKind.value ? [{ label: `${probe.name}${probe.serialNumber ? ` · ${probe.serialNumber}` : ""}${probe.accessible ? "" : ` · ${t("targetCatalog.notAccessible")}`}`, value: index, disabled: !probe.accessible }] : []));
watch([selectedId, selectedDeviceName, firmwarePath, startAddress, selectedDeviceAnalysis], () => {
  const generation = ++planGeneration;
  if (planTimer) clearTimeout(planTimer);
  flashPlan.value = null;
  planError.value = "";
  planning.value = false;
  programResult.value = null;
  if (!selected.value || !selectedDevice.value || !selectedDeviceAnalysis.value?.ready || !firmwarePath.value || (isBin.value && !startAddress.value)) return;
  const args = { packId: selected.value.id, packSha256: selected.value.sha256, device: selectedDevice.value.name, firmwarePath: firmwarePath.value, startAddress: startAddress.value };
  planning.value = true;
  planTimer = setTimeout(async () => {
    try {
      const result = await planBinaryFlash(args);
      if (generation === planGeneration && !unmounted) flashPlan.value = result;
    } catch (error) {
      if (generation === planGeneration && !unmounted) planError.value = error instanceof Error ? error.message : String(error);
    } finally {
      if (generation === planGeneration && !unmounted) planning.value = false;
    }
  }, 250);
});
async function refresh() {
  try {
    packs.value = await TargetCatalogService.list();
    analyses.value = await TargetCatalogService.listAnalyses();
    if (!packs.value.some((pack) => pack.id === selectedId.value)) selectedId.value = packs.value[0]?.id ?? "";
  } catch (error) { message.error(error instanceof Error ? error.message : String(error)); }
}
onMounted(refresh);
async function refreshProbes() {
  try {
    const current = selectedProbe.value;
    probes.value = await listSupportedProbes();
    if (!probes.value.some((probe) => probe.kind === probeKind.value && probe.accessible)) {
      const firstKind = probes.value.find((probe) => probe.accessible)?.kind;
      if (firstKind === "ST-Link" || firstKind === "CMSIS-DAP") probeKind.value = firstKind;
    }
    const previousIndex = current ? probes.value.findIndex((probe) => probe.kind === current.kind && probe.vendorId === current.vendorId && probe.productId === current.productId && probe.serialNumber === current.serialNumber && probe.interface === current.interface) : -1;
    selectedProbeIndex.value = previousIndex >= 0 ? previousIndex : probes.value.findIndex((probe) => probe.kind === probeKind.value && probe.accessible);
    if (selectedProbeIndex.value < 0) selectedProbeIndex.value = null;
  }
  catch (error) { message.error(error instanceof Error ? error.message : String(error)); }
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
  ++planGeneration;
  if (planTimer) clearTimeout(planTimer);
  if (session.value) disconnectProbeSession(session.value.sessionId).catch(() => {});
});
async function chooseFirmware() {
  try {
    const path = await pickBinaryFirmware();
    if (path) firmwarePath.value = path;
  } catch (error) { message.error(error instanceof Error ? error.message : String(error)); }
}
async function executeBinaryPlan() {
  if (!session.value || !flashPlan.value || busy.value) return;
  busy.value = true;
  try {
    programResult.value = await programBinary({
      sessionId: session.value.sessionId,
      firmwarePath: firmwarePath.value,
      startAddress: flashPlan.value.startAddress,
      expectedSha256: flashPlan.value.firmwareSha256,
    });
    session.value = await probeSessionStatus(session.value.sessionId);
    message.success(t("targetCatalog.programVerified"));
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error));
    try { session.value = await probeSessionStatus(session.value.sessionId); } catch { /* retain the error above */ }
  } finally { busy.value = false; }
}
async function eraseAllFlash() {
  if (!session.value || busy.value) return;
  busy.value = true;
  try {
    await eraseInternalFlash(session.value.sessionId);
    programResult.value = null;
    session.value = await probeSessionStatus(session.value.sessionId);
    message.success(t("programmer.eraseSuccess"));
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error));
    try { session.value = await probeSessionStatus(session.value.sessionId); } catch { /* keep erase error */ }
  } finally { busy.value = false; }
}
onMounted(refreshProbes);
</script>

<template>
  <div class="programmer">
    <header class="page-header">
      <div><h1>{{ t("tools.firmwareProgrammer") }}</h1><p>{{ t("programmer.workbenchHint") }}</p></div>
      <NTag round :type="session ? 'success' : 'default'">{{ session ? t("programmer.connected") : t("programmer.disconnected") }}</NTag>
    </header>
    <div class="workspace">
      <main class="main-column">
        <section class="panel">
          <div class="panel-heading"><h2>{{ t("programmer.targetTitle") }}</h2><span>{{ t("programmer.targetHint") }}</span></div>
          <div class="target-fields">
            <label>{{ t("programmer.packLabel") }}<NSelect v-model:value="selectedId" :options="packOptions" :disabled="!!session || busy" :placeholder="t('programmer.selectPack')" /></label>
            <label>{{ t("programmer.mcuLabel") }}<NSelect v-model:value="selectedDeviceName" :options="deviceOptions" filterable clearable :disabled="!analysis || !!session || busy" :placeholder="t('programmer.selectMcu')" /></label>
          </div>
          <p v-if="!packs.length" class="notice">{{ t("programmer.noPack") }}</p>
          <p v-else-if="!analysis" class="notice">{{ t("programmer.packNeedsValidation") }}</p>
          <p v-else-if="selectedDeviceAnalysis?.reason" class="notice">{{ selectedDeviceAnalysis.reason }}</p>
        </section>

        <section class="panel firmware-panel">
          <div class="panel-heading"><h2>{{ t("programmer.firmwareTitle") }}</h2><span>{{ t("programmer.firmwareHint") }}</span></div>
          <div class="file-picker"><NButton :disabled="busy" @click="chooseFirmware">{{ t("programmer.chooseFirmware") }}</NButton><span :title="firmwarePath">{{ firmwarePath || t("targetCatalog.noFirmware") }}</span></div>
          <div v-if="isBin" class="address-row"><label>{{ t("programmer.addressLabel") }}<NInput v-model:value="startAddress" :disabled="busy" :placeholder="t('targetCatalog.startAddress')" /></label></div>
          <p v-if="planError" class="notice">{{ planError }}</p>
        </section>

        <section class="panel review-panel">
          <div class="panel-heading"><h2>{{ t("programmer.reviewTitle") }}</h2><span>{{ t("programmer.reviewHint") }}</span></div>
          <div v-if="!flashPlan" class="empty-plan">{{ planning ? t("programmer.planning") : t("programmer.noPlan") }}</div>
          <template v-else>
            <div class="plan-grid"><div><small>{{ t("programmer.writeRange") }}</small><strong v-for="segment in flashPlan.segments" :key="segment.startAddress">{{ segment.startAddress }} → {{ segment.endAddressExclusive }}<br /></strong></div><div><small>{{ t("programmer.eraseRange") }}</small><strong v-for="segment in flashPlan.segments" :key="segment.startAddress">{{ segment.eraseStartAddress }} → {{ segment.eraseEndAddressExclusive }}<br /></strong></div><div><small>{{ t("programmer.firmwareSize") }}</small><strong>{{ flashPlan.format }} · {{ flashPlan.byteCount }} B</strong></div><div><small>{{ t("programmer.sectors") }}</small><strong>{{ flashPlan.eraseSectorCount }}</strong></div></div>
            <details class="plan-details"><summary>{{ t("programmer.planDetails") }}</summary><p>{{ flashPlan.memoryRegion }} · {{ flashPlan.flashAlgorithm }}</p><p class="mono">SHA-256: {{ flashPlan.firmwareSha256 }}</p></details>
          </template>
          <div class="program-actions">
            <div class="action-row">
              <NButton type="primary" size="large" :disabled="!session || !flashPlan || busy" :loading="busy" @click="executeBinaryPlan">{{ t("targetCatalog.programAndVerify") }}</NButton>
              <NPopconfirm :positive-text="t('programmer.confirmErase')" :negative-text="t('programmer.cancel')" @positive-click="eraseAllFlash"><template #trigger><NButton type="error" ghost :disabled="!session || busy">{{ t("programmer.fullErase") }}</NButton></template>{{ t("programmer.eraseConfirm", { part: selectedDevice?.name ?? "MCU" }) }}</NPopconfirm>
              <NButton disabled :title="t('programmer.optionsUnavailable')">{{ t("programmer.configurationOptions") }}</NButton>
            </div>
            <p v-if="programResult?.verified" class="success">✓ {{ t("targetCatalog.programVerified") }} · {{ programResult.byteCount }} B · SHA-256: {{ programResult.firmwareSha256 }}</p>
          </div>
        </section>
      </main>

      <aside class="side-column">
        <section class="panel connection-panel">
          <div class="panel-heading"><h2>{{ t("programmer.connectionTitle") }}</h2></div>
          <label>{{ t("programmer.interfaceLabel") }}<NSelect v-model:value="probeKind" :options="[{ label: 'ST-Link', value: 'ST-Link' }, { label: 'CMSIS-DAP', value: 'CMSIS-DAP' }]" :disabled="!!session || busy" /></label>
          <label>{{ t("programmer.selectProbe") }}<div class="probe-picker"><NSelect v-model:value="selectedProbeIndex" :options="probeOptions" :disabled="!!session || busy" :placeholder="t('programmer.selectProbe')" /><NButton :disabled="!!session || busy" @click="refreshProbes">↻</NButton></div></label>
          <p v-if="!probes.length" class="field-note">{{ t("targetCatalog.noProbes") }}</p>
          <p v-else-if="!probeOptions.length" class="field-note">{{ t("programmer.noProbeOfType", { kind: probeKind }) }}</p>
          <label>{{ t("programmer.speedLabel") }}<NInputNumber v-model:value="speedKhz" :min="100" :max="10000" :step="100" :disabled="!!session || busy" /></label>
          <NButton v-if="!session" type="primary" block size="large" :disabled="!selectedDeviceAnalysis?.ready || !selectedProbe?.accessible || busy" :loading="busy" @click="attachSession">{{ t("targetCatalog.connect") }}</NButton>
          <NButton v-else block size="large" :disabled="busy" @click="disconnectSession">{{ t("targetCatalog.disconnect") }}</NButton>
          <p v-if="!selectedDeviceAnalysis?.ready && !session" class="field-note">{{ t("programmer.connectNeedsTarget") }}</p>
          <div v-if="session" class="connection-summary"><NTag type="success">{{ t("programmer.connected") }}</NTag><span>{{ session.probeKind }} · {{ session.speedKhz }} kHz</span><span>{{ session.voltage ?? "?" }} V</span></div>
        </section>

        <section class="panel target-panel">
          <div class="panel-heading"><h2>{{ t("programmer.targetInfoTitle") }}</h2></div>
          <div class="info-row"><span>{{ t("programmer.mcuLabel") }}</span><strong>{{ selectedDevice?.name || "—" }}</strong></div>
          <div class="info-row"><span>{{ t("programmer.coreLabel") }}</span><strong>{{ selectedDevice?.core || "—" }}</strong></div>
        </section>

        <details v-if="session" class="panel advanced"><summary>{{ t("programmer.advanced") }}</summary><div class="advanced-body"><p class="mono">{{ session.sessionId }} · {{ session.coreTypes.join(", ") }}</p><div class="diagnostic-actions"><NButton size="small" :disabled="session.coreHalted || busy" @click="haltSession">{{ t("targetCatalog.halt") }}</NButton><NButton size="small" :disabled="!session.coreHalted || busy" @click="resumeSession">{{ t("targetCatalog.resume") }}</NButton><NTag :type="session.coreHalted ? 'warning' : 'success'">{{ session.coreHalted ? t("targetCatalog.halted") : t("targetCatalog.running") }}</NTag></div><div class="diagnostic-actions"><NInput v-model:value="ramAddress" :placeholder="t('targetCatalog.ramAddress')" /><NInputNumber v-model:value="ramLength" :min="1" :max="4096" /><NButton size="small" :disabled="busy" @click="readRam">{{ t("targetCatalog.readRam") }}</NButton></div><p v-if="ramRead" class="mono">{{ ramRead.address }}: {{ formatRamBytes(ramRead) }}</p></div></details>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.programmer{padding:24px;max-width:1500px;margin:auto}.page-header{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:18px}.page-header h1{margin:0;font-size:24px}.page-header p{margin:4px 0 0;opacity:.65}.workspace{display:grid;grid-template-columns:minmax(0,1fr) 318px;gap:16px;align-items:start}.main-column,.side-column{display:grid;gap:16px;min-width:0}.panel{border:1px solid #8884;border-radius:10px;padding:18px;background:#88806;min-width:0}.panel-heading{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:16px}.panel-heading h2{margin:0;font-size:17px}.panel-heading span{opacity:.6;font-size:12px}.target-fields{display:grid;grid-template-columns:1fr 1fr;gap:12px}.panel label{display:grid;gap:6px;font-weight:600;font-size:13px}.panel label :deep(.n-base-selection),.panel label :deep(.n-input){font-weight:400}.notice{padding:10px 12px;margin:12px 0 0;border-radius:6px;background:#e6a23c1a;color:#9a6700;font-size:13px}.file-picker,.address-row,.probe-picker,.action-row,.connection-summary,.identity-result,.diagnostic-actions{display:flex;align-items:center;gap:10px;min-width:0}.file-picker span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:.75}.address-row{margin-top:16px;align-items:end}.address-row label,.probe-picker :deep(.n-select){flex:1;min-width:0}.address-row button{white-space:nowrap}.field-note{font-size:12px;opacity:.6;margin:9px 0 14px}.empty-plan{min-height:80px;display:grid;place-items:center;border:1px dashed #8885;border-radius:7px;opacity:.55}.plan-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:14px;border-radius:7px;background:#18a05810}.plan-grid div{display:grid;gap:4px}.plan-grid small{opacity:.6}.plan-grid strong{font-size:13px;overflow-wrap:anywhere}.plan-details{margin:12px 0;font-size:12px}.mono{font:12px monospace;overflow-wrap:anywhere}.program-actions{border-top:1px solid #8883;margin-top:18px;padding-top:14px;display:grid;gap:12px}.program-actions p{margin:0;font-size:12px;opacity:.75}.action-row{flex-wrap:wrap}.action-hint{font-size:12px;opacity:.7}.program-actions .success{color:#18a058;font-weight:700;opacity:1;overflow-wrap:anywhere}.connection-panel{display:grid;gap:14px}.connection-panel .panel-heading{margin:0}.connection-panel .field-note{margin:0}.probe-picker{width:100%}.connection-summary{flex-wrap:wrap;font-size:12px}.target-panel .info-row{display:flex;justify-content:space-between;gap:12px;border-bottom:1px solid #8882;padding:8px 0;font-size:12px}.info-row span{opacity:.65}.info-row strong{text-align:right;overflow-wrap:anywhere}.identity-result{margin-top:15px;align-items:flex-start;flex-direction:column}.identity-result small{opacity:.65}.advanced{padding:0}.advanced summary{padding:16px 18px;cursor:pointer;font-weight:600}.advanced-body{padding:0 18px 18px;display:grid;gap:12px}.advanced-body p{margin:0}.diagnostic-actions{flex-wrap:wrap}.diagnostic-actions :deep(.n-input){max-width:150px}.diagnostic-actions :deep(.n-input-number){max-width:95px}@media(max-width:1050px){.workspace{grid-template-columns:minmax(0,1fr) 270px}.target-fields{grid-template-columns:1fr}}@media(max-width:760px){.workspace{grid-template-columns:1fr}.side-column{grid-row:1}.programmer{padding:16px}.target-fields{grid-template-columns:1fr}.address-row{align-items:stretch;flex-direction:column}.address-row label{width:100%}}
</style>
