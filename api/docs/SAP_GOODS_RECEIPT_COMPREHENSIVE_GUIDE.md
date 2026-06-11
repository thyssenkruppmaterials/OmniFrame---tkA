# SAP Goods Receipt - Comprehensive Implementation Guide

## Executive Summary

This document provides a complete analysis of SAP Goods Receipt functionality, covering all scenarios including EWM-controlled storage locations and POs with Confirmation Control settings. The research was conducted on SAP S/4HANA 2023 FPS00 (System S23, Client 100).

---

## 1. Current Z_RFC_GOODS_RECEIPT Analysis

### 1.1 Source Code Review

The current `Z_RFC_GOODS_RECEIPT` function module is a custom RFC that wraps `BAPI_GOODSMVT_CREATE`.

#### Import Parameters
| Parameter | SAP Type | Description | Required | Default |
|-----------|----------|-------------|----------|---------|
| I_MATERIAL | MATNR | Material Number | Yes | - |
| I_PLANT | WERKS_D | Plant | Yes | - |
| I_STORAGE_LOC | LGORT_D | Storage Location | Yes | - |
| I_QUANTITY | MENGE_D | Quantity | Yes | - |
| I_MOVEMENT_TYPE | BWART | Movement Type | No | '101' |
| I_PO_NUMBER | EBELN | Purchase Order Number | No | - |
| I_PO_ITEM | EBELP | PO Item Number | No | '00010' |

#### Export Parameters
| Parameter | SAP Type | Description |
|-----------|----------|-------------|
| E_MAT_DOC | MBLNR | Material Document Number |
| E_MAT_YEAR | MJAHR | Material Document Year |
| E_SUBRC | SY-SUBRC | Return Code (0=success, 4=error) |
| E_MESSAGE | CHAR200 | Message Text |

#### Current Logic Flow
```
1. Get unit of measure from MARA table
2. Set posting/document dates to current date
3. If PO provided:
   - GM_CODE = '01' (GR for PO)
   - Get storage location from EKPO if not provided
   - Set MVT_IND = 'B' (Movement Indicator for PO GR)
4. If no PO:
   - GM_CODE = '05' (Other goods receipts)
5. Call BAPI_GOODSMVT_CREATE
6. Check for errors in BAPIRET2
7. COMMIT or ROLLBACK transaction
```

### 1.2 Identified Limitations

| # | Limitation | Impact |
|---|------------|--------|
| 1 | **No EWM Support** | Cannot post to EWM-controlled storage locations |
| 2 | **No Confirmation Control Handling** | Fails for POs requiring Inbound Delivery |
| 3 | **No Shipping Notification Support** | Cannot handle ASN-required scenarios |
| 4 | **Missing EWM Reference Parameters** | Does not pass `GOODSMVT_REF_EWM` structure |
| 5 | **No Inbound Delivery Creation** | Requires manual ASN/IDel creation first |
| 6 | **Limited Error Messages** | Returns only first error |

---

## 2. BAPI_GOODSMVT_CREATE Deep Analysis

### 2.1 Complete Interface

#### Import Parameters
```abap
GOODSMVT_HEADER     TYPE BAPI2017_GM_HEAD_01      " Header data (required)
GOODSMVT_CODE       TYPE BAPI2017_GM_CODE         " GM Code (required)
TESTRUN             TYPE BAPI2017_GM_GEN-TESTRUN  " Test mode (optional)
GOODSMVT_REF_EWM    TYPE /SPE/BAPI2017_GM_REF_EWM " EWM Reference (optional) *** KEY FOR EWM ***
GOODSMVT_PRINT_CTRL TYPE BAPI2017_GM_PRINT        " Print control (optional)
```

#### Tables
```abap
GOODSMVT_ITEM           TYPE BAPI2017_GM_ITEM_CREATE        " Items
GOODSMVT_SERIALNUMBER   TYPE BAPI2017_GM_SERIALNUMBER       " Serial numbers
RETURN                  TYPE BAPIRET2                       " Messages
GOODSMVT_SERV_PART_DATA TYPE /SPE/BAPI2017_SERVICEPART_DATA " Service part data
EXTENSIONIN             TYPE BAPIPAREX                      " Extension
GOODSMVT_ITEM_CWM       TYPE /CWM/BAPI2017_GM_ITEM_CREATE   " Catch weight
```

### 2.2 Key EWM Parameters Discovered

#### /SPE/BAPI2017_GM_REF_EWM Structure
This structure allows referencing EWM documents in goods movement:
- Used when posting with reference to EWM warehouse tasks
- Mapped to internal IMKPF structure via `/SPE/MAP_GOODSMVT_REF_EWM`

#### EWM Reservation Handling
```abap
IF goodsmvt_ref_ewm IS NOT INITIAL AND 
   goodsmvt_item-reserv_no IS NOT INITIAL THEN
   " EWM reservation data filling
   CALL METHOD /spe/cl_ewm_material_request=>imseg_fill
END IF
```

### 2.3 GM_CODE Values
| Code | Description | Use Case |
|------|-------------|----------|
| 01 | Goods Receipt for PO | Standard PO GR |
| 02 | Goods Receipt for Production Order | Manufacturing |
| 03 | Goods Issue | Outbound |
| 04 | Transfer Posting | Stock transfers |
| 05 | Other Goods Receipts | Non-PO receipts (501) |
| 06 | Other Goods Issues | Non-order issues |

---

## 3. Available SAP Functions

### 3.1 EWM-Related Functions (/SCWM/*)

| Function | Description | Use Case |
|----------|-------------|----------|
| /SCWM/WHRHEAD_IND_GOODS_RCPT | Inbound Delivery Goods Receipt | **Primary EWM GR function** |
| /SCWM/WHRHEAD_OUT_GOODS_ISSUE | Outbound Delivery Goods Issue | EWM outbound |
| /SCWM/IDOC_OUTPUT_GOODSMVT_CR | Goods Movement Create | IDoc-based GR |
| /SCWM/IDOC_OUTPUT_GOODSMVT_CA | Goods Movement Cancel | GR reversal |
| /SCWM/PUT_BIN_DET | Storage Bin Determination | Putaway logic |
| /SCWM/IDOC_GOODSMVT | Goods Movement | Generic movement |

### 3.2 Inbound Delivery Functions

| Function | Description | Use Case |
|----------|-------------|----------|
| BAPI_INB_DELIVERY_CHANGE | Change Inbound Delivery | Modify existing ASN |
| BAPI_INB_DELIVERY_CONFIRM_DEC | Confirm from Decentralized System | Distributed scenarios |
| BAPI_INB_DELIVERY_SAVEREPLICA | Replicate Inbound Deliveries | Data synchronization |
| BAPI_INBOUND_DELIVERY_CREATE_SLS | Create Inbound Delivery SLS | Sales returns |

### 3.3 Related BAPIs

| Function | Description |
|----------|-------------|
| BAPI_TRANSACTION_COMMIT | Commit LUW |
| BAPI_TRANSACTION_ROLLBACK | Rollback LUW |
| BAPI_PO_GETDETAIL | Get PO details |
| BAPI_PO_GETITEMS | Get PO items |

---

## 4. Goods Receipt Process Flows

### 4.1 Scenario A: Standard GR (Non-EWM, No Confirmation Control)

```
┌─────────────────────────────────────────────────────────────┐
│  PO (EBELN) + Material + Quantity                           │
│                     │                                       │
│                     ▼                                       │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Z_RFC_GOODS_RECEIPT / BAPI_GOODSMVT_CREATE        │   │
│  │  GM_CODE = '01', MVT_IND = 'B'                      │   │
│  └─────────────────────────────────────────────────────┘   │
│                     │                                       │
│                     ▼                                       │
│  Material Document + Accounting Document                    │
└─────────────────────────────────────────────────────────────┘

✅ Current Z_RFC_GOODS_RECEIPT WORKS for this scenario
```

### 4.2 Scenario B: EWM-Controlled Storage Location

```
┌─────────────────────────────────────────────────────────────┐
│  PO (EBELN) + Material + Quantity                           │
│  Storage Location = EWM-managed (e.g., 101S)                │
│                     │                                       │
│                     ▼                                       │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Step 1: Create Inbound Delivery (ASN)              │   │
│  │  - BAPI_INB_DELIVERY_CHANGE or                      │   │
│  │  - VL31N Transaction equivalent                     │   │
│  └─────────────────────────────────────────────────────┘   │
│                     │                                       │
│                     ▼                                       │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Step 2: EWM Warehouse Task Creation                │   │
│  │  - /SCWM/PUT_BIN_DET (Putaway determination)        │   │
│  │  - /SCWM/TO_CREATE (Create warehouse task)          │   │
│  └─────────────────────────────────────────────────────┘   │
│                     │                                       │
│                     ▼                                       │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Step 3: Confirm Warehouse Task / Post GR           │   │
│  │  - /SCWM/WHRHEAD_IND_GOODS_RCPT or                  │   │
│  │  - BAPI_GOODSMVT_CREATE with GOODSMVT_REF_EWM       │   │
│  └─────────────────────────────────────────────────────┘   │
│                     │                                       │
│                     ▼                                       │
│  Material Document + EWM Posting + Accounting Document      │
└─────────────────────────────────────────────────────────────┘

❌ Current Z_RFC_GOODS_RECEIPT FAILS for this scenario
```

### 4.3 Scenario C: PO with Confirmation Control = Inbound Delivery

```
┌─────────────────────────────────────────────────────────────┐
│  PO (EBELN) with Confirmation Control = 0001 (Inb. Del.)    │
│                     │                                       │
│                     ▼                                       │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Step 1: Create Inbound Delivery (MANDATORY)        │   │
│  │  - BAPI_INB_DELIVERY_SAVEREPLICA                    │   │
│  │  - Delivery Type: EL (Inbound Delivery)             │   │
│  │  - Reference: PO Number & Item                      │   │
│  └─────────────────────────────────────────────────────┘   │
│                     │                                       │
│                     ▼                                       │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Step 2: Post GR with Reference to Inb. Delivery    │   │
│  │  - BAPI_GOODSMVT_CREATE                             │   │
│  │  - GM_CODE = '01'                                   │   │
│  │  - Reference: Inbound Delivery Number               │   │
│  └─────────────────────────────────────────────────────┘   │
│                     │                                       │
│                     ▼                                       │
│  Material Document + Accounting Document                    │
│  Inbound Delivery Status = Completed                        │
└─────────────────────────────────────────────────────────────┘

❌ Current Z_RFC_GOODS_RECEIPT FAILS for this scenario
   Error: "Confirmation control requires inbound delivery"
```

### 4.4 Scenario D: PO with Confirmation Control = Shipping Notification

```
┌─────────────────────────────────────────────────────────────┐
│  PO (EBELN) with Confirmation Control = 0002 (Ship. Notif.)│
│                     │                                       │
│                     ▼                                       │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Step 1: Receive ASN from Vendor (IDoc DESADV)      │   │
│  │  OR Create manually via VL31N                       │   │
│  └─────────────────────────────────────────────────────┘   │
│                     │                                       │
│                     ▼                                       │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Step 2: Verify ASN/Shipping Notification exists    │   │
│  │  - Check LIKP/LIPS tables                           │   │
│  │  - Validate ASN matches PO                          │   │
│  └─────────────────────────────────────────────────────┘   │
│                     │                                       │
│                     ▼                                       │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Step 3: Post GR with ASN Reference                 │   │
│  │  - BAPI_GOODSMVT_CREATE                             │   │
│  │  - Reference: ASN Number                            │   │
│  └─────────────────────────────────────────────────────┘   │
│                     │                                       │
│                     ▼                                       │
│  Material Document + Accounting Document                    │
└─────────────────────────────────────────────────────────────┘

❌ Current Z_RFC_GOODS_RECEIPT FAILS for this scenario
```

---

## 5. Detection Logic: Which Scenario Applies?

### 5.1 Decision Tree

```abap
" Step 1: Check if storage location is EWM-controlled
SELECT SINGLE lgnum FROM t001l
  INTO lv_lgnum
  WHERE werks = iv_plant
    AND lgort = iv_storage_loc
    AND lgnum IS NOT INITIAL.

IF sy-subrc = 0.
  " EWM-controlled storage location
  " → Use Scenario B (EWM flow)
  RETURN 'EWM'.
ENDIF.

" Step 2: Check PO Confirmation Control
SELECT SINGLE webre bstae FROM ekpo
  INTO (lv_webre, lv_bstae)
  WHERE ebeln = iv_po_number
    AND ebelp = iv_po_item.

CASE lv_bstae.
  WHEN '0001'.
    " Confirmation Control = Inbound Delivery required
    " → Use Scenario C
    RETURN 'INBOUND_DELIVERY'.
  WHEN '0002'.
    " Confirmation Control = Shipping Notification required
    " → Use Scenario D
    RETURN 'SHIPPING_NOTIFICATION'.
  WHEN OTHERS.
    " No special confirmation control
    " → Use Scenario A (standard)
    RETURN 'STANDARD'.
ENDCASE.
```

### 5.2 Key Tables for Detection

| Table | Field | Purpose |
|-------|-------|---------|
| T001L | LGNUM | EWM Warehouse Number (if filled, EWM-controlled) |
| EKPO | BSTAE | Confirmation Control Category |
| EKPO | WEBRE | GR-based Invoice Verification |
| /SCWM/TWHNO | - | EWM Warehouse configuration |
| LIKP | VBELN | Inbound Delivery header |
| LIPS | - | Inbound Delivery items |

---

## 6. Recommended Enhanced RFC Implementation

### 6.1 Proposed Interface

```abap
FUNCTION Z_RFC_GOODS_RECEIPT_ENHANCED.
*"----------------------------------------------------------------------
*"*"Local Interface:
*"  IMPORTING
*"    VALUE(I_MATERIAL) TYPE MATNR
*"    VALUE(I_PLANT) TYPE WERKS_D
*"    VALUE(I_STORAGE_LOC) TYPE LGORT_D
*"    VALUE(I_QUANTITY) TYPE MENGE_D
*"    VALUE(I_MOVEMENT_TYPE) TYPE BWART DEFAULT '101'
*"    VALUE(I_PO_NUMBER) TYPE EBELN OPTIONAL
*"    VALUE(I_PO_ITEM) TYPE EBELP OPTIONAL
*"    VALUE(I_VENDOR) TYPE LIFNR OPTIONAL
*"    VALUE(I_BATCH) TYPE CHARG_D OPTIONAL
*"    VALUE(I_INBOUND_DELIVERY) TYPE VBELN_VL OPTIONAL     " NEW
*"    VALUE(I_DELIVERY_ITEM) TYPE POSNR_VL OPTIONAL        " NEW
*"    VALUE(I_FORCE_SCENARIO) TYPE CHAR20 OPTIONAL         " NEW: Override detection
*"  EXPORTING
*"    VALUE(E_MAT_DOC) TYPE MBLNR
*"    VALUE(E_MAT_YEAR) TYPE MJAHR
*"    VALUE(E_INBOUND_DELIVERY) TYPE VBELN_VL              " NEW
*"    VALUE(E_SCENARIO_USED) TYPE CHAR20                   " NEW
*"    VALUE(E_SUBRC) TYPE SYSUBRC
*"    VALUE(E_MESSAGE) TYPE CHAR200
*"  TABLES
*"    T_RETURN STRUCTURE BAPIRET2 OPTIONAL                 " NEW: Full messages
*"----------------------------------------------------------------------
```

### 6.2 Pseudo-Code Implementation

```abap
FUNCTION z_rfc_goods_receipt_enhanced.

  DATA: lv_scenario TYPE char20,
        lv_ewm_wh   TYPE /scwm/lgnum,
        lv_bstae    TYPE bstae,
        lv_inb_del  TYPE vbeln_vl,
        ls_ref_ewm  TYPE /spe/bapi2017_gm_ref_ewm.

  " ================================================
  " STEP 1: Detect applicable scenario
  " ================================================
  
  IF i_force_scenario IS NOT INITIAL.
    lv_scenario = i_force_scenario.
  ELSE.
    PERFORM detect_scenario USING    i_plant
                                     i_storage_loc
                                     i_po_number
                                     i_po_item
                            CHANGING lv_scenario
                                     lv_ewm_wh
                                     lv_bstae.
  ENDIF.
  
  e_scenario_used = lv_scenario.

  " ================================================
  " STEP 2: Execute based on scenario
  " ================================================
  
  CASE lv_scenario.
  
    " ----------------------------------------
    " SCENARIO A: Standard GR (Non-EWM)
    " ----------------------------------------
    WHEN 'STANDARD'.
      PERFORM gr_standard USING    i_material
                                   i_plant
                                   i_storage_loc
                                   i_quantity
                                   i_movement_type
                                   i_po_number
                                   i_po_item
                                   i_vendor
                                   i_batch
                          CHANGING e_mat_doc
                                   e_mat_year
                                   e_subrc
                                   e_message
                                   t_return[].

    " ----------------------------------------
    " SCENARIO B: EWM-Controlled
    " ----------------------------------------
    WHEN 'EWM'.
      " Check if inbound delivery already exists
      IF i_inbound_delivery IS INITIAL.
        " Step B1: Create Inbound Delivery
        PERFORM create_inbound_delivery USING    i_po_number
                                                 i_po_item
                                                 i_quantity
                                                 i_vendor
                                        CHANGING lv_inb_del
                                                 e_subrc
                                                 e_message
                                                 t_return[].
        IF e_subrc <> 0.
          RETURN.
        ENDIF.
        e_inbound_delivery = lv_inb_del.
      ELSE.
        lv_inb_del = i_inbound_delivery.
        e_inbound_delivery = lv_inb_del.
      ENDIF.
      
      " Step B2: Post GR with EWM reference
      ls_ref_ewm-ewm_lgnum = lv_ewm_wh.
      
      PERFORM gr_with_ewm_reference USING    i_material
                                             i_plant
                                             i_storage_loc
                                             i_quantity
                                             i_movement_type
                                             i_po_number
                                             i_po_item
                                             lv_inb_del
                                             ls_ref_ewm
                                    CHANGING e_mat_doc
                                             e_mat_year
                                             e_subrc
                                             e_message
                                             t_return[].

    " ----------------------------------------
    " SCENARIO C: Inbound Delivery Required
    " ----------------------------------------
    WHEN 'INBOUND_DELIVERY'.
      " Check if inbound delivery provided
      IF i_inbound_delivery IS INITIAL.
        " Step C1: Create Inbound Delivery first
        PERFORM create_inbound_delivery USING    i_po_number
                                                 i_po_item
                                                 i_quantity
                                                 i_vendor
                                        CHANGING lv_inb_del
                                                 e_subrc
                                                 e_message
                                                 t_return[].
        IF e_subrc <> 0.
          RETURN.
        ENDIF.
        e_inbound_delivery = lv_inb_del.
      ELSE.
        lv_inb_del = i_inbound_delivery.
        e_inbound_delivery = lv_inb_del.
      ENDIF.
      
      " Step C2: Post GR with inbound delivery reference
      PERFORM gr_with_inbound_delivery USING    lv_inb_del
                                                i_delivery_item
                                                i_quantity
                                       CHANGING e_mat_doc
                                                e_mat_year
                                                e_subrc
                                                e_message
                                                t_return[].

    " ----------------------------------------
    " SCENARIO D: Shipping Notification Required
    " ----------------------------------------
    WHEN 'SHIPPING_NOTIFICATION'.
      " Check if ASN/Shipping Notification exists
      IF i_inbound_delivery IS INITIAL.
        e_subrc = 4.
        e_message = 'Shipping Notification (ASN) required but not provided'.
        RETURN.
      ENDIF.
      
      " Verify ASN matches PO
      PERFORM verify_asn_matches_po USING    i_inbound_delivery
                                             i_po_number
                                    CHANGING e_subrc
                                             e_message.
      IF e_subrc <> 0.
        RETURN.
      ENDIF.
      
      " Post GR with ASN reference
      PERFORM gr_with_inbound_delivery USING    i_inbound_delivery
                                                i_delivery_item
                                                i_quantity
                                       CHANGING e_mat_doc
                                                e_mat_year
                                                e_subrc
                                                e_message
                                                t_return[].

    " ----------------------------------------
    " Unknown scenario
    " ----------------------------------------
    WHEN OTHERS.
      e_subrc = 4.
      e_message = 'Unknown scenario detected'.
      
  ENDCASE.

ENDFUNCTION.
```

### 6.3 Key Subroutines

#### detect_scenario
```abap
FORM detect_scenario USING    iv_plant TYPE werks_d
                              iv_storage_loc TYPE lgort_d
                              iv_po_number TYPE ebeln
                              iv_po_item TYPE ebelp
                     CHANGING cv_scenario TYPE char20
                              cv_ewm_wh TYPE /scwm/lgnum
                              cv_bstae TYPE bstae.

  DATA: lv_lgnum TYPE lgnum.

  " Check EWM control (T001L or S/4 specific table)
  SELECT SINGLE lgnum FROM t001l
    INTO @lv_lgnum
    WHERE werks = @iv_plant
      AND lgort = @iv_storage_loc.
  
  " In S/4HANA, also check /SCWM/TWHNO for EWM warehouse
  IF lv_lgnum IS NOT INITIAL.
    cv_ewm_wh = lv_lgnum.
    cv_scenario = 'EWM'.
    RETURN.
  ENDIF.

  " Check Confirmation Control on PO
  IF iv_po_number IS NOT INITIAL.
    SELECT SINGLE bstae FROM ekpo
      INTO @cv_bstae
      WHERE ebeln = @iv_po_number
        AND ebelp = @iv_po_item.
    
    CASE cv_bstae.
      WHEN '0001'.
        cv_scenario = 'INBOUND_DELIVERY'.
        RETURN.
      WHEN '0002'.
        cv_scenario = 'SHIPPING_NOTIFICATION'.
        RETURN.
    ENDCASE.
  ENDIF.

  " Default: Standard scenario
  cv_scenario = 'STANDARD'.

ENDFORM.
```

#### create_inbound_delivery
```abap
FORM create_inbound_delivery USING    iv_po_number TYPE ebeln
                                      iv_po_item TYPE ebelp
                                      iv_quantity TYPE menge_d
                                      iv_vendor TYPE lifnr
                             CHANGING cv_inb_del TYPE vbeln_vl
                                      cv_subrc TYPE sysubrc
                                      cv_message TYPE char200
                                      ct_return TYPE table.

  DATA: ls_header  TYPE bapi_inb_delivery_header,
        lt_items   TYPE TABLE OF bapi_inb_delivery_item,
        ls_item    TYPE bapi_inb_delivery_item,
        lt_return  TYPE TABLE OF bapiret2.

  " Populate header
  ls_header-dlv_type = 'EL'.        " Inbound delivery type
  ls_header-vendor   = iv_vendor.
  ls_header-ship_date = sy-datum.

  " Populate item
  ls_item-po_number = iv_po_number.
  ls_item-po_item   = iv_po_item.
  ls_item-dlv_qty   = iv_quantity.
  APPEND ls_item TO lt_items.

  " Call BAPI to create/replicate inbound delivery
  CALL FUNCTION 'BAPI_INB_DELIVERY_SAVEREPLICA'
    EXPORTING
      header_data = ls_header
    IMPORTING
      delivery    = cv_inb_del
    TABLES
      item_data   = lt_items
      return      = lt_return.

  " Process return
  LOOP AT lt_return INTO DATA(ls_ret) WHERE type CA 'EA'.
    cv_subrc = 4.
    cv_message = ls_ret-message.
    APPEND ls_ret TO ct_return.
  ENDLOOP.

  IF cv_subrc = 0.
    CALL FUNCTION 'BAPI_TRANSACTION_COMMIT'
      EXPORTING
        wait = 'X'.
  ELSE.
    CALL FUNCTION 'BAPI_TRANSACTION_ROLLBACK'.
  ENDIF.

ENDFORM.
```

---

## 7. Python API Integration

### 7.1 Enhanced SAP Service

```python
# api/services/sap_goods_receipt_service.py

from typing import Optional, Dict, Any, List
from pyrfc import Connection
from dataclasses import dataclass
from enum import Enum

class GRScenario(Enum):
    STANDARD = "STANDARD"
    EWM = "EWM"
    INBOUND_DELIVERY = "INBOUND_DELIVERY"
    SHIPPING_NOTIFICATION = "SHIPPING_NOTIFICATION"

@dataclass
class GoodsReceiptResult:
    success: bool
    material_document: Optional[str]
    material_year: Optional[str]
    inbound_delivery: Optional[str]
    scenario_used: GRScenario
    message: str
    return_messages: List[Dict[str, Any]]

class SAPGoodsReceiptService:
    """Enhanced Goods Receipt service supporting all scenarios."""
    
    def __init__(self, connection: Connection):
        self.conn = connection
    
    async def post_goods_receipt(
        self,
        material: str,
        plant: str,
        storage_location: str,
        quantity: float,
        po_number: Optional[str] = None,
        po_item: Optional[str] = None,
        movement_type: str = "101",
        vendor: Optional[str] = None,
        batch: Optional[str] = None,
        inbound_delivery: Optional[str] = None,
        delivery_item: Optional[str] = None,
        force_scenario: Optional[GRScenario] = None
    ) -> GoodsReceiptResult:
        """
        Post goods receipt supporting all scenarios:
        - Standard (non-EWM, no confirmation control)
        - EWM-controlled storage locations
        - PO with Confirmation Control = Inbound Delivery
        - PO with Confirmation Control = Shipping Notification
        """
        
        try:
            # Prepare parameters
            params = {
                "I_MATERIAL": material.upper().zfill(18),
                "I_PLANT": plant,
                "I_STORAGE_LOC": storage_location,
                "I_QUANTITY": quantity,
                "I_MOVEMENT_TYPE": movement_type,
            }
            
            if po_number:
                params["I_PO_NUMBER"] = po_number.zfill(10)
            if po_item:
                params["I_PO_ITEM"] = po_item.zfill(5)
            if vendor:
                params["I_VENDOR"] = vendor.zfill(10)
            if batch:
                params["I_BATCH"] = batch
            if inbound_delivery:
                params["I_INBOUND_DELIVERY"] = inbound_delivery
            if delivery_item:
                params["I_DELIVERY_ITEM"] = delivery_item
            if force_scenario:
                params["I_FORCE_SCENARIO"] = force_scenario.value
            
            # Call enhanced RFC
            result = self.conn.call("Z_RFC_GOODS_RECEIPT_ENHANCED", **params)
            
            # Process result
            return GoodsReceiptResult(
                success=result.get("E_SUBRC", 4) == 0,
                material_document=result.get("E_MAT_DOC"),
                material_year=result.get("E_MAT_YEAR"),
                inbound_delivery=result.get("E_INBOUND_DELIVERY"),
                scenario_used=GRScenario(result.get("E_SCENARIO_USED", "STANDARD")),
                message=result.get("E_MESSAGE", ""),
                return_messages=result.get("T_RETURN", [])
            )
            
        except Exception as e:
            return GoodsReceiptResult(
                success=False,
                material_document=None,
                material_year=None,
                inbound_delivery=None,
                scenario_used=GRScenario.STANDARD,
                message=str(e),
                return_messages=[]
            )
    
    async def detect_scenario(
        self,
        plant: str,
        storage_location: str,
        po_number: Optional[str] = None,
        po_item: Optional[str] = None
    ) -> GRScenario:
        """
        Detect which GR scenario applies without posting.
        Useful for UI to show appropriate workflow.
        """
        
        # Check EWM control
        if await self._is_ewm_controlled(plant, storage_location):
            return GRScenario.EWM
        
        # Check PO confirmation control
        if po_number:
            confirmation_control = await self._get_confirmation_control(
                po_number, po_item
            )
            if confirmation_control == "0001":
                return GRScenario.INBOUND_DELIVERY
            elif confirmation_control == "0002":
                return GRScenario.SHIPPING_NOTIFICATION
        
        return GRScenario.STANDARD
    
    async def _is_ewm_controlled(
        self, 
        plant: str, 
        storage_location: str
    ) -> bool:
        """Check if storage location is EWM-controlled."""
        try:
            result = self.conn.call(
                "RFC_READ_TABLE",
                QUERY_TABLE="T001L",
                DELIMITER="|",
                OPTIONS=[{"TEXT": f"WERKS = '{plant}' AND LGORT = '{storage_location}'"}],
                FIELDS=[{"FIELDNAME": "LGNUM"}]
            )
            
            for row in result.get("DATA", []):
                values = row["WA"].split("|")
                if values and values[0].strip():
                    return True
            return False
            
        except Exception:
            return False
    
    async def _get_confirmation_control(
        self,
        po_number: str,
        po_item: Optional[str] = None
    ) -> Optional[str]:
        """Get confirmation control category from PO item."""
        try:
            where_clause = f"EBELN = '{po_number.zfill(10)}'"
            if po_item:
                where_clause += f" AND EBELP = '{po_item.zfill(5)}'"
            
            result = self.conn.call(
                "RFC_READ_TABLE",
                QUERY_TABLE="EKPO",
                DELIMITER="|",
                OPTIONS=[{"TEXT": where_clause}],
                FIELDS=[{"FIELDNAME": "BSTAE"}]
            )
            
            for row in result.get("DATA", []):
                values = row["WA"].split("|")
                if values:
                    return values[0].strip()
            return None
            
        except Exception:
            return None
```

---

## 8. Summary & Recommendations

### 8.1 Immediate Actions

1. **Create Enhanced RFC** (`Z_RFC_GOODS_RECEIPT_ENHANCED`)
   - Implement scenario detection logic
   - Add EWM reference handling
   - Add Inbound Delivery creation capability

2. **Update Python API**
   - Implement `SAPGoodsReceiptService` class
   - Add scenario detection endpoint
   - Update existing GR endpoints to use enhanced RFC

3. **Update Frontend**
   - Add scenario detection before GR posting
   - Show appropriate UI based on detected scenario
   - Handle Inbound Delivery creation workflow

### 8.2 Testing Checklist

| Scenario | Test Case | Expected Result |
|----------|-----------|-----------------|
| A | Standard PO GR | Material Document created |
| B | EWM storage location | Inbound Delivery + Mat Doc created |
| C | PO with Conf. Control 0001 | Inbound Delivery + Mat Doc created |
| D | PO with Conf. Control 0002 | Error if no ASN provided |
| D | PO with Conf. Control + ASN | Mat Doc created with ASN reference |

### 8.3 Key SAP Notes

- SAP Note 2442675 - EWM Material Request handling
- SAP Note 1977564 - Goods movement from EWM
- SAP Note 984907 - BAPI extension handling

---

## Appendix A: Error Codes Reference

| Code | Message | Resolution |
|------|---------|------------|
| M7-259 | Invalid GM code | Check GOODSMVT_CODE value |
| VL-701 | Inbound delivery required | Create Inbound Delivery first |
| M7-036 | Storage location blocked | Check T001L configuration |
| /SCWM/* | EWM-specific errors | Check EWM warehouse configuration |

---

## Appendix B: Transaction Codes

| TCode | Description |
|-------|-------------|
| MIGO | Goods Movement (GUI) |
| VL31N | Create Inbound Delivery |
| VL32N | Change Inbound Delivery |
| /SCWM/MON | EWM Monitor |
| /SCWM/PRDO | EWM Product Data |
| SE37 | Function Builder |
| SE16 | Data Browser |

---

*Document Version: 1.0*
*Last Updated: 2026-01-24*
*Research conducted on: SAP S/4HANA 2023 FPS00 (S23/100)*
