use probe_rs::probe::{
    cmsisdap::CmsisDapFactory,
    list::{Accessibility, ProbeListItem},
    stlink::StLinkFactory,
    ProbeFactory,
};

use crate::domain::probe::ProbeRecord;

pub fn list_supported_probes() -> Vec<ProbeRecord> {
    // Call only these factories; the generic lister also probes J-Link devices.
    let mut probes = Vec::new();
    probes.extend(convert("ST-Link", StLinkFactory.list_probes()));
    probes.extend(convert("CMSIS-DAP", CmsisDapFactory.list_probes()));
    probes
}

fn convert(kind: &str, items: Vec<ProbeListItem>) -> Vec<ProbeRecord> {
    items
        .into_iter()
        .map(|item| ProbeRecord {
            kind: kind.to_owned(),
            name: item.info.identifier,
            vendor_id: item.info.vendor_id,
            product_id: item.info.product_id,
            serial_number: item.info.serial_number,
            interface: item.info.interface,
            accessible: item.accessibility == Accessibility::Accessible,
        })
        .collect()
}
