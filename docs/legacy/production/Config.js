// === Config: getConfig_, setupScriptProperties, getCompanyInfo (Script Properties) ===
// ==========================================
// Config Helpers — อ่านจาก Script Properties
// รัน setupScriptProperties() ครั้งแรกหลัง deploy
// ==========================================

/**
 * อ่านค่า Config จาก Script Properties
 * มี fallback ป้องกันกรณียังไม่ได้ตั้งค่า
 * @private
 */
function getConfig_() {
  const props = PropertiesService.getScriptProperties();
  return {
    companyName:   props.getProperty('COMPANY_NAME')   || 'บริษัท อินทร์ เสพเทมเบ้อ จำกัด',
    exciseId:      props.getProperty('EXCISE_ID')      || '0605567002178-1-001',
    expectedToken: props.getProperty('EXPECTED_TOKEN') || 'Domesuperduperhandsome'
  };
}

/**
 * รันครั้งเดียวหลัง deploy เพื่อบันทึกค่า Config ลง Script Properties
 * วิธีรัน: Apps Script Editor → เลือกฟังก์ชัน setupScriptProperties → กด ▶ Run
 */
function setupScriptProperties() {
  PropertiesService.getScriptProperties().setProperties({
    'COMPANY_NAME':   'บริษัท อินทร์ เสพเทมเบ้อ จำกัด',
    'EXCISE_ID':      '0605567002178-1-001',
    'EXPECTED_TOKEN': 'Domesuperduperhandsome'
  });
  Logger.log('✅ Script Properties ตั้งค่าเรียบร้อยแล้ว');
}

/**
 * ส่งข้อมูลบริษัทให้ HTML (เรียกจาก google.script.run)
 */
function getCompanyInfo() {
  try {
    const cfg = getConfig_();
    return { success: true, companyName: cfg.companyName, exciseId: cfg.exciseId };
  } catch (e) {
    return { success: false, companyName: 'Insep Distillery', exciseId: '-' };
  }
}

