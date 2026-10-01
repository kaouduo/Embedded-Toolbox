<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { NButton, NCheckbox, NInput, NInputNumber, NSelect, NTag, useMessage } from "naive-ui";
import { useI18n } from "vue-i18n";
import { RouterLink } from "vue-router";
import { TargetCatalogService, type PackAnalysis, type PackRecord } from "@/services/native/target-catalog-service";
import { attachProbeSession, disconnectProbeSession, haltProbeSession, inspectProbeTarget, listSupportedProbes, probeSessionStatus, readProbeRam, resumeProbeSession, type ProbeRecord, type ProbeSessionInfo, type RamReadResult, type TargetIdentityResult } from "@/services/native/probe-service";
import { pickBinaryFirmware, planBinaryFlash, programBinary, type BinaryFlashPlan, type BinaryProgramResult } from "@/services/native/flash-plan-service";

const { t } = useI18n();
const message = useMessage();
const packs = ref<PackRecord[]>([]);
const analyses = ref<PackAnalysis[]>([]);
const probes = ref<ProbeRecord[]>([]);
const selectedProbeIndex = ref<number | null>(null);
const selectedProbe = computed(() => selectedProbeIndex.value === null ? undefined : probes.value[selectedProbeIndex.value]);
const speedKhz = ref(1800);
const session = ref<ProbeSessionInfo | null>(null);
const targetIdentity = ref<TargetIdentityResult | null>(null);
let unmounted = false;
const ramRead = ref<RamReadResult | null>(null);
const ramAddress = ref("0x20000000");
const ramLength = ref(64);
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
const packOptions = computed(() => packs.value.map((pack) => ({ label: `${pack.vendor} ${pack.name} · v${pack.version}`, value: pack.id })));
const deviceOptions = computed(() => selected.value?.devices.filter((device) => analysis.value?.targets.some((target) => target.name === device.name && target.ready)).map((device) => ({ label: device.name, value: device.name })) ?? []);
const probeOptions = computed(() => probes.value.map((probe, index) => ({ label: `${probe.kind} · ${probe.name}${probe.serialNumber ? ` · ${probe.serialNumber}` : ""}`, value: index, disabled: !probe.accessible })));
const suggestedAddress = computed(() => selectedDevice.value?.algorithms.find((item) => item.default && item.start)?.start
  ?? selectedDevice.value?.algorithms.find((item) => item.start)?.start ?? null);
const nextStep = computed(() => {
  if (!packs.value.length) return "nextImport";
  if (!analysis.value) return "nextValidate";
  if (!selectedDevice.value) return "nextTarget";
  if (!selectedDeviceAnalysis.value?.ready) return "nextUnsupported";
  if (!firmwarePath.value || !startAddress.value) return "nextFirmware";
  if (!flashPlan.value) return "nextPlan";
  if (programResult.value?.verified) return "nextVerified";
  if (!session.value) return "nextProbe";
  if (!targetIdentity.value) return "nextIdentity";
  if (!targetIdentity.value.flashCompatible) return "nextMismatch";
  return "nextProgram";
});
watch([selectedId, selectedDeviceName, firmwarePath, startAddress], () => {
  flashPlan.value = null;
  programResult.value = null;
  confirmedPart.value = false;
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
  try { probes.value = await listSupportedProbes(); selectedProbeIndex.value = null; }
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
    try { targetIdentity.value = await inspectProbeTarget(attached.sessionId); }
    catch (error) { targetIdentity.value = null; message.warning(error instanceof Error ? error.message : String(error)); }
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
  <div class="programmer">
    <header class="page-header"><div><h1>{{ t("tools.firmwareProgrammer") }}</h1><p>{{ t("programmer.description") }}</p></div><RouterLink to="/device/packs">{{ t("tools.packManager") }} →</RouterLink></header>
    <div class="layout">
      <main class="steps">
        <section class="card">
          <div class="step-title"><span class="number">1</span><div><h2>{{ t("programmer.targetTitle") }}</h2><p>{{ t("programmer.targetHint") }}</p></div></div>
          <div v-if="!packs.length" class="empty">{{ t("programmer.noPack") }} <RouterLink to="/device/packs">{{ t("targetCatalog.import") }} →</RouterLink></div>
          <div v-else class="fields">
            <label>{{ t("programmer.packLabel") }}<NSelect v-model:value="selectedId" :options="packOptions" :disabled="!!session || busy" /></label>
            <label>{{ t("programmer.mcuLabel") }}<NSelect v-model:value="selectedDeviceName" :options="deviceOptions" filterable clearable :disabled="!analysis || !!session || busy" :placeholder="t('programmer.selectMcu')" /></label>
            <p v-if="!analysis" class="hint">{{ t("programmer.packNeedsValidation") }} <RouterLink to="/device/packs">{{ t("tools.packManager") }} →</RouterLink></p>
            <p v-if="selectedDeviceAnalysis?.reason" class="hint">{{ selectedDeviceAnalysis.reason }}</p>
          </div>
        </section>
        <section class="card" :class="{ muted: !selectedDeviceAnalysis?.ready }">
          <div class="step-title"><span class="number">2</span><div><h2>{{ t("programmer.firmwareTitle") }}</h2><p>{{ t("programmer.firmwareHint") }}</p></div></div>
          <div class="fields">
            <div class="file-row"><NButton :disabled="!selectedDeviceAnalysis?.ready || busy" @click="chooseFirmware">{{ t("targetCatalog.chooseBin") }}</NButton><span class="file-path">{{ firmwarePath || t("targetCatalog.noFirmware") }}</span></div>
            <label>{{ t("programmer.addressLabel") }}<div class="address-row"><NInput v-model:value="startAddress" :disabled="!selectedDeviceAnalysis?.ready || busy" :placeholder="t('targetCatalog.startAddress')" /><NButton v-if="suggestedAddress" :disabled="!selectedDeviceAnalysis?.ready || busy" @click="startAddress = suggestedAddress">{{ t("targetCatalog.useAddress") }} {{ suggestedAddress }}</NButton></div></label>
            <p class="hint">{{ t("programmer.addressHint") }}</p>
            <NButton :disabled="!selectedDeviceAnalysis?.ready || !firmwarePath || !startAddress || busy" :loading="busy" @click="previewBinaryPlan">{{ t("targetCatalog.previewPlan") }}</NButton>
            <div v-if="flashPlan" class="plan"><div class="plan-grid"><div><small>{{ t("programmer.writeRange") }}</small><strong>{{ flashPlan.startAddress }} → {{ flashPlan.endAddressExclusive }}</strong></div><div><small>{{ t("programmer.eraseRange") }}</small><strong>{{ flashPlan.eraseStartAddress }} → {{ flashPlan.eraseEndAddressExclusive }}</strong></div><div><small>{{ t("programmer.firmwareSize") }}</small><strong>{{ flashPlan.byteCount }} B</strong></div><div><small>{{ t("programmer.sectors") }}</small><strong>{{ flashPlan.eraseSectorCount }}</strong></div></div><details><summary>{{ t("programmer.planDetails") }}</summary><p>{{ flashPlan.memoryRegion }} · {{ flashPlan.flashAlgorithm }}</p><p class="hash">SHA-256: {{ flashPlan.firmwareSha256 }}</p></details></div>
          </div>
        </section>
        <section class="card" :class="{ muted: !flashPlan }">
          <div class="step-title"><span class="number">3</span><div><h2>{{ t("programmer.probeTitle") }}</h2><p>{{ t("programmer.probeHint") }}</p></div></div>
          <div class="fields">
            <div class="probe-row"><NSelect v-model:value="selectedProbeIndex" :options="probeOptions" :disabled="!!session || busy || !flashPlan" :placeholder="t('programmer.selectProbe')" /><NButton :disabled="!!session || busy" @click="refreshProbes">{{ t("targetCatalog.refresh") }}</NButton></div>
            <p v-if="!probes.length" class="hint">{{ t("targetCatalog.noProbes") }}</p>
            <div v-if="!session" class="probe-row"><label>{{ t("programmer.speedLabel") }}<NInputNumber v-model:value="speedKhz" :min="100" :max="10000" :step="100" :disabled="!flashPlan || busy" /></label><NButton type="primary" :disabled="!flashPlan || !selectedProbe?.accessible || busy" :loading="busy" @click="attachSession">{{ t("targetCatalog.connect") }}</NButton></div>
            <div v-else class="session-row"><div><NTag type="success">{{ t("programmer.connected") }}</NTag><span>{{ session.probeKind }} · {{ session.targetName }} · {{ session.voltage ?? "?" }} V</span></div><NButton size="small" :disabled="busy" @click="disconnectSession">{{ t("targetCatalog.disconnect") }}</NButton></div>
            <p v-if="session && !targetIdentity" class="hint">{{ t("programmer.identityUnavailable") }} <NButton text :disabled="busy" @click="inspectTarget">{{ t("targetCatalog.inspectTarget") }}</NButton></p>
            <div v-if="targetIdentity" class="identity" :class="{ error: !targetIdentity.flashCompatible }"><NTag :type="targetIdentity.flashCompatible ? 'success' : 'error'">{{ targetIdentity.flashCompatible ? t("programmer.identityMatch") : t("programmer.identityMismatch") }}</NTag><span>{{ t("targetCatalog.identityResult", { id: targetIdentity.deviceId, size: targetIdentity.flashKib }) }}</span></div>
          </div>
        </section>
        <section class="card final-card" :class="{ muted: !targetIdentity?.flashCompatible || !flashPlan }">
          <div class="step-title"><span class="number">4</span><div><h2>{{ t("programmer.programTitle") }}</h2><p>{{ t("programmer.programHint") }}</p></div></div>
          <div class="fields"><p class="hint">{{ t("targetCatalog.programNotice") }}</p><NCheckbox v-model:checked="confirmedPart" :disabled="!targetIdentity?.flashCompatible || !flashPlan">{{ t("targetCatalog.confirmPart", { part: targetIdentity?.expectedMarking ?? selectedDevice?.name ?? "MCU" }) }}</NCheckbox><NButton type="error" size="large" :disabled="!flashPlan || !targetIdentity?.flashCompatible || !confirmedPart || busy" :loading="busy" @click="executeBinaryPlan">{{ t("targetCatalog.programAndVerify") }}</NButton><div v-if="programResult?.verified" class="success">✓ {{ t("targetCatalog.programVerified") }} · {{ programResult.byteCount }} B</div></div>
        </section>
        <details v-if="session" class="advanced"><summary>{{ t("programmer.advanced") }}</summary><div class="advanced-body"><p>{{ session.sessionId }} · {{ session.coreTypes.join(", ") }} · {{ session.speedKhz }} kHz</p><div class="actions"><NButton size="small" :disabled="session.coreHalted || busy" @click="haltSession">{{ t("targetCatalog.halt") }}</NButton><NButton size="small" :disabled="!session.coreHalted || busy" @click="resumeSession">{{ t("targetCatalog.resume") }}</NButton><NTag :type="session.coreHalted ? 'warning' : 'success'">{{ session.coreHalted ? t("targetCatalog.halted") : t("targetCatalog.running") }}</NTag></div><div class="actions"><NInput v-model:value="ramAddress" :placeholder="t('targetCatalog.ramAddress')" style="max-width:180px" /><NInputNumber v-model:value="ramLength" :min="1" :max="4096" style="max-width:120px" /><NButton size="small" :disabled="busy" @click="readRam">{{ t("targetCatalog.readRam") }}</NButton></div><p v-if="ramRead" class="hash">{{ ramRead.address }}: {{ formatRamBytes(ramRead) }}</p></div></details>
      </main>
      <aside class="status"><h2>{{ t("programmer.statusTitle") }}</h2><p>{{ t(`targetCatalog.${nextStep}`) }}</p><div class="status-list"><div><span>1</span>{{ selectedDevice?.name || t("programmer.targetTitle") }}</div><div><span>2</span>{{ firmwarePath ? firmwarePath.split(/[\\/]/).pop() : t("programmer.firmwareTitle") }}</div><div><span>3</span>{{ session ? session.probeKind : t("programmer.probeTitle") }}</div><div><span>4</span>{{ programResult?.verified ? t("targetCatalog.programVerified") : t("programmer.programTitle") }}</div></div></aside>
    </div>
  </div>
</template>

<style scoped>
.programmer{max-width:1320px;margin:auto;padding:28px}.page-header{display:flex;justify-content:space-between;align-items:center;gap:20px;margin-bottom:24px}.page-header h1{margin:0}.page-header p{margin:5px 0 0;opacity:.7}.layout{display:grid;grid-template-columns:minmax(0,1fr) 245px;gap:22px;align-items:start}.steps{display:grid;gap:16px}.card,.status,.advanced{border:1px solid #8884;border-radius:12px;background:#88808;padding:20px;min-width:0}.card.muted{opacity:.7}.step-title{display:flex;gap:14px;align-items:flex-start;margin-bottom:18px}.step-title h2,.status h2{font-size:18px;margin:0}.step-title p{margin:4px 0 0;opacity:.65}.number{display:grid;place-items:center;background:#18a058;color:#fff;border-radius:50%;width:28px;height:28px;flex:none;font-weight:700}.fields{display:grid;gap:14px}.fields label{display:grid;gap:6px;font-weight:600}.fields label :deep(.n-base-selection),.fields label :deep(.n-input){font-weight:400}.file-row,.address-row,.probe-row,.session-row,.session-row>div,.actions,.identity{display:flex;align-items:center;gap:10px;min-width:0}.address-row>:first-child,.probe-row>:first-child{flex:1;min-width:0}.file-path{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:.75}.hint{font-size:13px;opacity:.7;margin:0}.empty{padding:16px;background:#8881;border-radius:8px}.plan{padding:15px;border-radius:8px;background:#18a05812;border:1px solid #18a05855}.plan-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.plan-grid div{display:grid;gap:4px}.plan-grid small{opacity:.65}.plan-grid strong{font-size:13px;overflow-wrap:anywhere}.plan details{margin-top:12px}.hash{font:12px monospace;overflow-wrap:anywhere}.session-row{justify-content:space-between}.session-row>div{flex-wrap:wrap}.identity{flex-wrap:wrap}.identity.error{color:#d03050}.final-card .fields>:deep(.n-button){justify-self:start;min-width:200px}.success{color:#18a058;font-weight:700}.advanced{padding:0}.advanced summary{padding:16px 20px;cursor:pointer}.advanced-body{padding:0 20px 20px;display:grid;gap:12px}.actions{flex-wrap:wrap}.status{position:sticky;top:20px}.status p{line-height:1.5}.status-list{display:grid;gap:14px;margin-top:20px}.status-list div{display:flex;align-items:center;gap:10px;overflow-wrap:anywhere}.status-list span{width:24px;height:24px;flex:none;border-radius:50%;display:grid;place-items:center;background:#8883}@media(max-width:900px){.layout{grid-template-columns:1fr}.status{position:static;order:-1}}@media(max-width:600px){.programmer{padding:16px}.page-header{align-items:flex-start}.plan-grid{grid-template-columns:1fr}.address-row,.probe-row{flex-wrap:wrap}}
</style>
