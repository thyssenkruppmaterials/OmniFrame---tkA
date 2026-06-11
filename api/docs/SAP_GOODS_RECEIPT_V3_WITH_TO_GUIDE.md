# Z_RFC_GOODS_RECEIPT_V3 - Goods Receipt with Automatic Transfer Order Creation

## Executive Summary

This document provides complete specifications for `Z_RFC_GOODS_RECEIPT_V3`, an enhanced RFC function module that combines Goods Receipt posting with automatic Transfer Order (TO) creation for putaway operations. This enables a single RFC call to:

1. Post Goods Receipt using `BAPI_GOODSMVT_CREATE`
2. Create Transfer Order for putaway using `L_TO_CREATE_SINGLE`

**Research conducted on:** SAP S/4HANA 2023 FPS00 (System S23, Client 100)
**Last Updated:** 2026-01-27

---

## 1. Available SAP Transfer Order Creation Functions

### 1.1 Function Search Results (SE37)

The following L_TO_CREATE* functions are available in SAP for Transfer Order creation:

| Function | Group | Description | Best Use Case |
|----------|-------|-------------|---------------|
| **L_TO_CREATE_SINGLE** | L03B | Create a transfer order with one item | **RECOMMENDED** - Material-based putaway |
| L_TO_CREATE_MOVE_SU | L03B | Create TO for moving storage units | Storage Unit-based operations (requires LENUM) |
| L_TO_CREATE_DN | L03B | Create TO for delivery note | Delivery-based putaway |
| L_TO_CREATE_DN_MULTIPLE | L03B | Create TO for multiple delivery notes | Multiple delivery processing |
| L_TO_CREATE_MULTIPLE | L03B | Create TO with multiple items | Multi-item operations |
| L_TO_CREATE_POSTING_CHANGE | L03B | Create TO for posting change | Stock status changes |
| L_TO_CREATE_TR | L03B | Create TO for transfer requirement | Transfer requirement-based |
| L_TO_CREATE_2_STEP_PICKING | L03B | Create TO for 2-step picking | Warehouse picking operations |
| L_TO_CREATE_INT | L03A | Internal TO creation (kernel) | Called internally by other functions |
| L_TO_CREATE_GET_INFO | L03A | Get internal tables for TO creation | Helper function |
| L_TO_CREATE_STOCK_LIST_INT | L03A | Get stock list during TO creation | Helper function |

### 1.2 Recommended Function: L_TO_CREATE_SINGLE

**Why L_TO_CREATE_SINGLE?**

For GR+Putaway scenarios, `L_TO_CREATE_SINGLE` is the ideal choice because:
- Accepts material number and quantity directly (no storage unit required)
- Allows specifying source storage type (902 - GR interim) and destination
- Returns TO number for tracking
- Supports batch/quant specification
- Handles commit/rollback internally

---

## 2. L_TO_CREATE_SINGLE Interface Documentation

### 2.1 Import Parameters

| Parameter | SAP Type | Default | Required | Description |
|-----------|----------|---------|----------|-------------|
| **I_LGNUM** | LTAK-LGNUM | - | **Yes** | Warehouse Number (e.g., '034') |
| **I_BWLVS** | LTAK-BWLVS | - | **Yes** | WM Movement Type (e.g., '999' for manual TO) |
| **I_MATNR** | LTAP-MATNR | - | **Yes** | Material Number |
| **I_WERKS** | LTAP-WERKS | - | **Yes** | Plant |
| **I_ANFME** | RL03T-ANFME | - | **Yes** | Request Quantity |
| **I_ALTME** | LTAP-ALTME | - | **Yes** | Alternative Unit of Measure |
| I_BETYP | LTAK-BETYP | SPACE | No | Reference Document Type |
| I_BENUM | LTAK-BENUM | SPACE | No | Reference Document Number |
| I_LGORT | LTAP-LGORT | SPACE | No | Storage Location |
| I_CHARG | LTAP-CHARG | SPACE | No | Batch Number |
| I_BESTQ | LTAP-BESTQ | SPACE | No | Stock Category |
| I_SOBKZ | LTAP-SOBKZ | SPACE | No | Special Stock Indicator |
| I_SONUM | LTAP-SONUM | SPACE | No | Special Stock Number |
| I_LETYP | LTAP-LETYP | SPACE | No | Storage Unit Type |
| I_WDATU | LTAP-WDATU | INIT_DATUM | No | GR Date |
| I_VFDAT | LTAP-VFDAT | INIT_DATUM | No | Best Before Date |
| I_ZEUGN | LTAP-ZEUGN | SPACE | No | Inspection Certificate |
| I_LZNUM | LTAK-LZNUM | SPACE | No | Group |
| I_SQUIT | RL03T-SQUIT | SPACE | No | Immediate Confirmation ('X' to auto-confirm) |
| I_NIDRU | RL03A-NIDRU | SPACE | No | Do Not Print ('X' to suppress) |
| I_DRUKZ | T329F-DRUKZ | SPACE | No | Print Code |
| I_LDEST | LTAP-LDEST | SPACE | No | Output Device/Printer |
| I_WEMPF | LTAP-WEMPF | SPACE | No | Goods Recipient |
| I_ABLAD | LTAP-ABLAD | SPACE | No | Unloading Point |
| **I_VLTYP** | LTAP-VLTYP | SPACE | **Yes for putaway** | Source Storage Type (e.g., '902') |
| I_VLBER | LTAP-VLBER | SPACE | No | Source Storage Section |
| I_VLPLA | LTAP-VLPLA | SPACE | No | Source Storage Bin |
| I_VPPOS | LTAP-VPPOS | SPACE | No | Source Position |
| I_VLENR | LTAP-VLENR | SPACE | No | Source Storage Unit Number |
| I_VLQNR | LTAP-VLQNR | SPACE | No | Source Quant |
| **I_NLTYP** | LTAP-NLTYP | SPACE | **Yes for putaway** | Destination Storage Type |
| I_NLBER | LTAP-NLBER | SPACE | No | Destination Storage Section |
| I_NLPLA | LTAP-NLPLA | SPACE | No | Destination Storage Bin |
| I_NPPOS | LTAP-NPPOS | SPACE | No | Destination Position |
| I_NLENR | LTAP-NLENR | SPACE | No | Destination Storage Unit Number |
| I_NLQNR | LTAP-NLQNR | SPACE | No | Destination Quant |
| I_RLTYP | LTAP-RLTYP | SPACE | No | Return Storage Type |
| I_RLBER | LTAP-RLBER | SPACE | No | Return Storage Section |
| I_RLPLA | LTAP-RLPLA | SPACE | No | Return Storage Bin |
| I_RLQNR | LTAP-RLQNR | SPACE | No | Return Quant |
| I_UPDATE_TASK | RL03A-VERBU | SPACE | No | Update via Update Task |
| I_COMMIT_WORK | RL03B-COMIT | 'X' | No | Commit Work ('X' = commit) |
| I_BNAME | LTAK-BNAME | SY-UNAME | No | User Name |
| I_KOMPL | RL03B-KOMPL | 'X' | No | Complete Indicator |
| I_SOLEX | LTAK-SOLEX | 0 | No | Processing Time |
| I_PERNR | LTAK-PERNR | 0 | No | Personnel Number |
| I_AUSFB | LTAK-AUSFB | SPACE | No | Execution Type |
| I_SGT_SCAT | LTAP-SGT_SCAT | SPACE | No | Stock Segment |

### 2.2 Export Parameters

| Parameter | SAP Type | Description |
|-----------|----------|-------------|
| **E_TANUM** | LTAK-TANUM | **Transfer Order Number** (10-digit) |
| E_LTAP | LTAP | Transfer Order Item Structure |

### 2.3 Tables Parameters

| Parameter | Structure | Optional | Description |
|-----------|-----------|----------|-------------|
| T_LTAK | LTAK_VB | Yes | TO Header Data |
| T_LTAP_VB | LTAP_VB | Yes | TO Item Data |

### 2.4 Exceptions

| Exception | Description |
|-----------|-------------|
| NO_TO_CREATED | Transfer order could not be created |
| BWLVS_WRONG | Invalid movement type |
| BETYP_WRONG | Invalid reference document type |
| BENUM_MISSING | Reference number required but missing |
| BETYP_MISSING | Reference type required but missing |
| FOREIGN_LOCK | Object locked by another user |
| VLTYP_WRONG | Invalid source storage type |
| VLPLA_WRONG | Invalid source storage bin |
| VLTYP_MISSING | Source storage type required but missing |
| NLTYP_WRONG | Invalid destination storage type |
| NLPLA_WRONG | Invalid destination storage bin |
| NLTYP_MISSING | Destination storage type required but missing |
| SQUIT_FORBIDDEN | Immediate confirmation not allowed |
| MANUAL_TO_FORBIDDEN | Manual TO creation not allowed |
| MATERIAL_NOT_FOUND | Material not found in warehouse |
| NO_AUTHORITY | Authorization check failed |
| UPDATE_WITHOUT_COMMIT | Update task without commit |

---

## 3. Z_RFC_GOODS_RECEIPT_V3 Specification

### 3.1 Function Module Interface

```abap
FUNCTION Z_RFC_GOODS_RECEIPT_V3.
*"----------------------------------------------------------------------
*"*"Remote-Enabled Function Module
*"----------------------------------------------------------------------
*"  IMPORTING
*"    VALUE(I_MATERIAL) TYPE MATNR
*"    VALUE(I_PLANT) TYPE WERKS_D
*"    VALUE(I_STORAGE_LOC) TYPE LGORT_D
*"    VALUE(I_QUANTITY) TYPE MENGE_D
*"    VALUE(I_MOVEMENT_TYPE) TYPE BWART DEFAULT '101'
*"    VALUE(I_PO_NUMBER) TYPE EBELN OPTIONAL
*"    VALUE(I_PO_ITEM) TYPE EBELP DEFAULT '00010'
*"    VALUE(I_VENDOR) TYPE LIFNR OPTIONAL
*"    VALUE(I_BATCH) TYPE CHARG_D OPTIONAL
*"    VALUE(I_KOSTL) TYPE KOSTL OPTIONAL
*"    VALUE(I_CREATE_TO) TYPE CHAR1 DEFAULT SPACE        " 'X' = Create TO
*"    VALUE(I_WAREHOUSE) TYPE LGNUM OPTIONAL             " Warehouse Number
*"    VALUE(I_SRC_STORAGE_TYPE) TYPE LGTYP DEFAULT '902' " Source ST (GR interim)
*"    VALUE(I_DEST_STORAGE_TYPE) TYPE LGTYP OPTIONAL     " Destination ST
*"    VALUE(I_DEST_STORAGE_BIN) TYPE LGPLA OPTIONAL      " Destination Bin
*"    VALUE(I_WM_MOVEMENT_TYPE) TYPE BWLVS DEFAULT '999' " WM Movement Type
*"    VALUE(I_CONFIRM_TO) TYPE CHAR1 DEFAULT SPACE       " 'X' = Auto-confirm TO
*"  EXPORTING
*"    VALUE(E_MAT_DOC) TYPE MBLNR
*"    VALUE(E_MAT_YEAR) TYPE MJAHR
*"    VALUE(E_TO_NUMBER) TYPE TANUM                      " Transfer Order Number
*"    VALUE(E_SUBRC) TYPE SYSUBRC
*"    VALUE(E_MESSAGE) TYPE BAPI_MSG
*"----------------------------------------------------------------------
```

### 3.2 Parameter Descriptions

#### Import Parameters

| Parameter | Type | Default | Required | Description |
|-----------|------|---------|----------|-------------|
| I_MATERIAL | MATNR | - | Yes | Material Number |
| I_PLANT | WERKS_D | - | Yes | Plant |
| I_STORAGE_LOC | LGORT_D | - | Yes | Storage Location |
| I_QUANTITY | MENGE_D | - | Yes | Quantity |
| I_MOVEMENT_TYPE | BWART | '101' | No | IM Movement Type |
| I_PO_NUMBER | EBELN | - | No | Purchase Order Number |
| I_PO_ITEM | EBELP | '00010' | No | PO Item Number |
| I_VENDOR | LIFNR | - | No | Vendor/Supplier |
| I_BATCH | CHARG_D | - | No | Batch Number |
| I_KOSTL | KOSTL | - | No | Cost Center |
| **I_CREATE_TO** | CHAR1 | SPACE | No | **'X' = Create Transfer Order** |
| **I_WAREHOUSE** | LGNUM | - | **Yes if I_CREATE_TO='X'** | Warehouse Number (e.g., '034') |
| I_SRC_STORAGE_TYPE | LGTYP | '902' | No | Source Storage Type (GR interim) |
| I_DEST_STORAGE_TYPE | LGTYP | - | No | Destination Storage Type |
| I_DEST_STORAGE_BIN | LGPLA | - | No | Destination Storage Bin |
| I_WM_MOVEMENT_TYPE | BWLVS | '999' | No | WM Movement Type for TO |
| I_CONFIRM_TO | CHAR1 | SPACE | No | 'X' = Auto-confirm Transfer Order |

#### Export Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| E_MAT_DOC | MBLNR | Material Document Number |
| E_MAT_YEAR | MJAHR | Material Document Year |
| **E_TO_NUMBER** | TANUM | **Transfer Order Number** (if created) |
| E_SUBRC | SYSUBRC | Return Code (0=success, 4=error) |
| E_MESSAGE | BAPI_MSG | Message Text |

---

## 4. Complete ABAP Source Code

```abap
FUNCTION Z_RFC_GOODS_RECEIPT_V3.
*"----------------------------------------------------------------------
*"*"Remote-Enabled Function Module
*"*"----------------------------------------------------------------------
*"  IMPORTING
*"    VALUE(I_MATERIAL) TYPE MATNR
*"    VALUE(I_PLANT) TYPE WERKS_D
*"    VALUE(I_STORAGE_LOC) TYPE LGORT_D
*"    VALUE(I_QUANTITY) TYPE MENGE_D
*"    VALUE(I_MOVEMENT_TYPE) TYPE BWART DEFAULT '101'
*"    VALUE(I_PO_NUMBER) TYPE EBELN OPTIONAL
*"    VALUE(I_PO_ITEM) TYPE EBELP DEFAULT '00010'
*"    VALUE(I_VENDOR) TYPE LIFNR OPTIONAL
*"    VALUE(I_BATCH) TYPE CHARG_D OPTIONAL
*"    VALUE(I_KOSTL) TYPE KOSTL OPTIONAL
*"    VALUE(I_CREATE_TO) TYPE CHAR1 DEFAULT SPACE
*"    VALUE(I_WAREHOUSE) TYPE LGNUM OPTIONAL
*"    VALUE(I_SRC_STORAGE_TYPE) TYPE LGTYP DEFAULT '902'
*"    VALUE(I_DEST_STORAGE_TYPE) TYPE LGTYP OPTIONAL
*"    VALUE(I_DEST_STORAGE_BIN) TYPE LGPLA OPTIONAL
*"    VALUE(I_WM_MOVEMENT_TYPE) TYPE BWLVS DEFAULT '999'
*"    VALUE(I_CONFIRM_TO) TYPE CHAR1 DEFAULT SPACE
*"  EXPORTING
*"    VALUE(E_MAT_DOC) TYPE MBLNR
*"    VALUE(E_MAT_YEAR) TYPE MJAHR
*"    VALUE(E_TO_NUMBER) TYPE TANUM
*"    VALUE(E_SUBRC) TYPE SYSUBRC
*"    VALUE(E_MESSAGE) TYPE BAPI_MSG
*"----------------------------------------------------------------------

* Data declarations for Goods Receipt
  DATA: ls_header     TYPE bapi2017_gm_head_01,
        ls_code       TYPE bapi2017_gm_code,
        ls_item       TYPE bapi2017_gm_item_create,
        lt_items      TYPE TABLE OF bapi2017_gm_item_create,
        lt_return     TYPE TABLE OF bapiret2,
        ls_return     TYPE bapiret2,
        lv_mat_doc    TYPE bapi2017_gm_head_ret-mat_doc,
        lv_mat_year   TYPE bapi2017_gm_head_ret-doc_year,
        lv_meins      TYPE meins,
        lv_lgort      TYPE lgort_d.

* Data declarations for Transfer Order
  DATA: lv_to_number  TYPE ltak-tanum,
        lv_to_subrc   TYPE sy-subrc.

* Initialize return values
  CLEAR: E_MAT_DOC, E_MAT_YEAR, E_TO_NUMBER, E_SUBRC, E_MESSAGE.

*======================================================================
* PART 1: POST GOODS RECEIPT
*======================================================================

* Get unit of measure from material master
  SELECT SINGLE meins FROM mara
    INTO lv_meins
    WHERE matnr = I_MATERIAL.
  IF sy-subrc <> 0 OR lv_meins IS INITIAL.
    lv_meins = 'PC'.  " Default to pieces
  ENDIF.

* Determine storage location
  IF I_STORAGE_LOC IS NOT INITIAL.
    lv_lgort = I_STORAGE_LOC.
  ELSEIF I_PO_NUMBER IS NOT INITIAL.
    " Get storage location from PO item
    SELECT SINGLE lgort FROM ekpo
      INTO lv_lgort
      WHERE ebeln = I_PO_NUMBER
        AND ebelp = I_PO_ITEM.
    IF sy-subrc <> 0 OR lv_lgort IS INITIAL.
      lv_lgort = I_STORAGE_LOC.
    ENDIF.
  ENDIF.

* Populate header
  ls_header-pstng_date = sy-datum.
  ls_header-doc_date   = sy-datum.

* Determine GM_CODE based on PO
  IF I_PO_NUMBER IS NOT INITIAL.
    ls_code-gm_code = '01'.  " GR for PO
  ELSE.
    ls_code-gm_code = '05'.  " Other goods receipts
  ENDIF.

* Populate item
  ls_item-material   = I_MATERIAL.
  ls_item-plant      = I_PLANT.
  ls_item-stge_loc   = lv_lgort.
  ls_item-move_type  = I_MOVEMENT_TYPE.
  ls_item-entry_qnt  = I_QUANTITY.
  ls_item-entry_uom  = lv_meins.

  IF I_PO_NUMBER IS NOT INITIAL.
    ls_item-po_number  = I_PO_NUMBER.
    ls_item-po_item    = I_PO_ITEM.
    ls_item-mvt_ind    = 'B'.  " Critical for PO goods receipt
  ENDIF.

  IF I_VENDOR IS NOT INITIAL.
    ls_item-vendor = I_VENDOR.
  ENDIF.

  IF I_BATCH IS NOT INITIAL.
    ls_item-batch = I_BATCH.
  ENDIF.

  IF I_KOSTL IS NOT INITIAL.
    ls_item-costcenter = I_KOSTL.
  ENDIF.

  APPEND ls_item TO lt_items.

* Call Goods Receipt BAPI
  CALL FUNCTION 'BAPI_GOODSMVT_CREATE'
    EXPORTING
      goodsmvt_header = ls_header
      goodsmvt_code   = ls_code
    IMPORTING
      materialdocument = lv_mat_doc
      matdocumentyear  = lv_mat_year
    TABLES
      goodsmvt_item    = lt_items
      return           = lt_return.

* Check for errors
  LOOP AT lt_return INTO ls_return WHERE type CA 'EA'.
    E_SUBRC   = 4.
    E_MESSAGE = ls_return-message.
    CALL FUNCTION 'BAPI_TRANSACTION_ROLLBACK'.
    RETURN.
  ENDLOOP.

* Commit goods receipt
  CALL FUNCTION 'BAPI_TRANSACTION_COMMIT'
    EXPORTING
      wait = 'X'.

* Set GR outputs
  E_MAT_DOC  = lv_mat_doc.
  E_MAT_YEAR = lv_mat_year.

*======================================================================
* PART 2: CREATE TRANSFER ORDER (IF REQUESTED)
*======================================================================

  IF I_CREATE_TO = 'X'.

*   Validate warehouse is provided
    IF I_WAREHOUSE IS INITIAL.
      E_SUBRC   = 4.
      E_MESSAGE = 'Warehouse number required for TO creation'.
      RETURN.
    ENDIF.

*   Create Transfer Order using L_TO_CREATE_SINGLE
    CALL FUNCTION 'L_TO_CREATE_SINGLE'
      EXPORTING
        i_lgnum           = I_WAREHOUSE           " Warehouse number
        i_bwlvs           = I_WM_MOVEMENT_TYPE    " WM movement type
        i_matnr           = I_MATERIAL            " Material
        i_werks           = I_PLANT               " Plant
        i_lgort           = lv_lgort              " Storage location
        i_charg           = I_BATCH               " Batch (if any)
        i_anfme           = I_QUANTITY            " Quantity
        i_altme           = lv_meins              " Unit of measure
        i_vltyp           = I_SRC_STORAGE_TYPE    " Source storage type (902)
        i_nltyp           = I_DEST_STORAGE_TYPE   " Destination storage type
        i_nlpla           = I_DEST_STORAGE_BIN    " Destination bin (optional)
        i_squit           = I_CONFIRM_TO          " Immediate confirmation
        i_nidru           = 'X'                   " Suppress printing
        i_commit_work     = 'X'                   " Commit work
      IMPORTING
        e_tanum           = lv_to_number          " Transfer order number
      EXCEPTIONS
        no_to_created          = 1
        bwlvs_wrong            = 2
        betyp_wrong            = 3
        benum_missing          = 4
        betyp_missing          = 5
        foreign_lock           = 6
        vltyp_wrong            = 7
        vlpla_wrong            = 8
        vltyp_missing          = 9
        nltyp_wrong            = 10
        nlpla_wrong            = 11
        nltyp_missing          = 12
        squit_forbidden        = 13
        manual_to_forbidden    = 14
        material_not_found     = 15
        no_authority           = 16
        update_without_commit  = 17
        OTHERS                 = 99.

    lv_to_subrc = sy-subrc.

    IF lv_to_subrc = 0.
*     TO created successfully
      E_TO_NUMBER = lv_to_number.
*     Keep E_SUBRC = 0 (GR was successful, TO was successful)

    ELSE.
*     TO creation failed - but GR was successful
*     Return warning with GR success info
      E_SUBRC = 2.  " Warning: GR OK but TO failed

      CASE lv_to_subrc.
        WHEN 1.
          E_MESSAGE = 'GR successful, but TO creation failed: No TO created'.
        WHEN 2.
          E_MESSAGE = 'GR successful, but TO creation failed: Invalid WM movement type'.
        WHEN 6.
          E_MESSAGE = 'GR successful, but TO creation failed: Object locked'.
        WHEN 7.
          E_MESSAGE = 'GR successful, but TO creation failed: Invalid source storage type'.
        WHEN 9.
          E_MESSAGE = 'GR successful, but TO creation failed: Source storage type missing'.
        WHEN 10.
          E_MESSAGE = 'GR successful, but TO creation failed: Invalid destination storage type'.
        WHEN 12.
          E_MESSAGE = 'GR successful, but TO creation failed: Destination storage type missing'.
        WHEN 13.
          E_MESSAGE = 'GR successful, but TO creation failed: Immediate confirmation forbidden'.
        WHEN 14.
          E_MESSAGE = 'GR successful, but TO creation failed: Manual TO creation forbidden'.
        WHEN 15.
          E_MESSAGE = 'GR successful, but TO creation failed: Material not found in warehouse'.
        WHEN 16.
          E_MESSAGE = 'GR successful, but TO creation failed: No authorization'.
        WHEN OTHERS.
          E_MESSAGE = 'GR successful, but TO creation failed: Unknown error'.
      ENDCASE.

    ENDIF.

  ENDIF.

ENDFUNCTION.
```

---

## 5. SE37 Setup Instructions

### Tab 1: Attributes

| Field | Value |
|-------|-------|
| Function module | Z_RFC_GOODS_RECEIPT_V3 |
| Short text | Goods Receipt with Transfer Order Creation |
| Function group | Z_RFC_WM (create new or use existing) |
| Processing type | Remote-Enabled Module |

### Tab 2: Import Parameters

| Parameter Name | Typing | Associated Type | Default value | Optional | Pass by Value |
|----------------|--------|-----------------|---------------|----------|---------------|
| I_MATERIAL | TYPE | MATNR | | ☐ | ☑ |
| I_PLANT | TYPE | WERKS_D | | ☐ | ☑ |
| I_STORAGE_LOC | TYPE | LGORT_D | | ☐ | ☑ |
| I_QUANTITY | TYPE | MENGE_D | | ☐ | ☑ |
| I_MOVEMENT_TYPE | TYPE | BWART | '101' | ☑ | ☑ |
| I_PO_NUMBER | TYPE | EBELN | | ☑ | ☑ |
| I_PO_ITEM | TYPE | EBELP | '00010' | ☑ | ☑ |
| I_VENDOR | TYPE | LIFNR | | ☑ | ☑ |
| I_BATCH | TYPE | CHARG_D | | ☑ | ☑ |
| I_KOSTL | TYPE | KOSTL | | ☑ | ☑ |
| I_CREATE_TO | TYPE | CHAR1 | SPACE | ☑ | ☑ |
| I_WAREHOUSE | TYPE | LGNUM | | ☑ | ☑ |
| I_SRC_STORAGE_TYPE | TYPE | LGTYP | '902' | ☑ | ☑ |
| I_DEST_STORAGE_TYPE | TYPE | LGTYP | | ☑ | ☑ |
| I_DEST_STORAGE_BIN | TYPE | LGPLA | | ☑ | ☑ |
| I_WM_MOVEMENT_TYPE | TYPE | BWLVS | '999' | ☑ | ☑ |
| I_CONFIRM_TO | TYPE | CHAR1 | SPACE | ☑ | ☑ |

### Tab 3: Export Parameters

| Parameter Name | Typing | Associated Type | Pass by Value |
|----------------|--------|-----------------|---------------|
| E_MAT_DOC | TYPE | MBLNR | ☑ |
| E_MAT_YEAR | TYPE | MJAHR | ☑ |
| E_TO_NUMBER | TYPE | TANUM | ☑ |
| E_SUBRC | TYPE | SYSUBRC | ☑ |
| E_MESSAGE | TYPE | BAPI_MSG | ☑ |

### Tab 4: Changing Parameters
(None required)

### Tab 5: Tables Parameters
(None required)

### Tab 6: Exceptions
(None required - handled via E_SUBRC and E_MESSAGE)

### Tab 7: Source Code
Copy the ABAP code from Section 4 above.

---

## 6. Test Parameters

### Test Case 1: GR Only (No TO)

```
I_MATERIAL        = 'EWMS4-01'
I_PLANT           = '1010'
I_STORAGE_LOC     = '0034'
I_QUANTITY        = 10
I_MOVEMENT_TYPE   = '501'
I_CREATE_TO       = ' '

Expected Result:
- E_MAT_DOC = (new document number)
- E_MAT_YEAR = '2026'
- E_TO_NUMBER = '' (empty)
- E_SUBRC = 0
- E_MESSAGE = '' (empty)
```

### Test Case 2: GR with PO

```
I_MATERIAL        = 'EWMS4-01'
I_PLANT           = '1010'
I_STORAGE_LOC     = '0034'
I_QUANTITY        = 5
I_MOVEMENT_TYPE   = '101'
I_PO_NUMBER       = '4500000123'
I_PO_ITEM         = '00010'
I_CREATE_TO       = ' '

Expected Result:
- E_MAT_DOC = (new document number)
- E_MAT_YEAR = '2026'
- E_TO_NUMBER = '' (empty)
- E_SUBRC = 0
- E_MESSAGE = '' (empty)
```

### Test Case 3: GR + TO Creation (Putaway from 902)

```
I_MATERIAL           = 'EWMS4-01'
I_PLANT              = '1010'
I_STORAGE_LOC        = '0034'
I_QUANTITY           = 10
I_MOVEMENT_TYPE      = '501'
I_CREATE_TO          = 'X'
I_WAREHOUSE          = '034'
I_SRC_STORAGE_TYPE   = '902'
I_DEST_STORAGE_TYPE  = '001'
I_WM_MOVEMENT_TYPE   = '999'

Expected Result:
- E_MAT_DOC = (new document number)
- E_MAT_YEAR = '2026'
- E_TO_NUMBER = (new TO number, 10 digits)
- E_SUBRC = 0
- E_MESSAGE = '' (empty)
```

### Test Case 4: GR + TO with Auto-Confirmation

```
I_MATERIAL           = 'EWMS4-01'
I_PLANT              = '1010'
I_STORAGE_LOC        = '0034'
I_QUANTITY           = 5
I_MOVEMENT_TYPE      = '501'
I_CREATE_TO          = 'X'
I_WAREHOUSE          = '034'
I_SRC_STORAGE_TYPE   = '902'
I_DEST_STORAGE_TYPE  = '001'
I_DEST_STORAGE_BIN   = 'A-01-01'
I_WM_MOVEMENT_TYPE   = '999'
I_CONFIRM_TO         = 'X'

Expected Result:
- E_MAT_DOC = (new document number)
- E_MAT_YEAR = '2026'
- E_TO_NUMBER = (new TO number, confirmed)
- E_SUBRC = 0
- E_MESSAGE = '' (empty)
```

### Test Case 5: GR + TO without Warehouse (Error)

```
I_MATERIAL           = 'EWMS4-01'
I_PLANT              = '1010'
I_STORAGE_LOC        = '0034'
I_QUANTITY           = 10
I_MOVEMENT_TYPE      = '501'
I_CREATE_TO          = 'X'
I_WAREHOUSE          = ''           " Missing warehouse

Expected Result:
- E_MAT_DOC = (new document number - GR succeeds)
- E_MAT_YEAR = '2026'
- E_TO_NUMBER = '' (empty)
- E_SUBRC = 4
- E_MESSAGE = 'Warehouse number required for TO creation'
```

---

## 7. Configuration Requirements

### 7.1 Warehouse Configuration Checklist

| Item | Table | Transaction | Description |
|------|-------|-------------|-------------|
| Warehouse Number | T300 | LS10 | Warehouse '034' must exist |
| Storage Types | T301 | LS05 | Types 902, 001, etc. must be defined |
| Storage Location Assignment | T320 | SPRO | Plant 1010 + Storage Loc 0034 → Warehouse 034 |
| Movement Types | T333 | LS01 | WM Movement Type 999 for manual TO |
| Storage Type Control | T334 | SPRO | Storage type putaway strategy |

### 7.2 Key Configuration Tables

| Table | Purpose |
|-------|---------|
| T300 | Warehouse Number Definition |
| T301 | Storage Types |
| T320 | Storage Location Assignment to Warehouse |
| T333 | WM Movement Type Reference |
| T334 | Storage Type Search for TO |

### 7.3 Storage Type 902 Configuration

Storage Type 902 is typically configured as:
- **Type:** GR Interim Storage
- **Purpose:** Temporary holding area for goods receipt
- **Behavior:** Stock is placed here automatically after GR
- **Next Step:** TO moves stock from 902 to final destination

---

## 8. Process Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    Z_RFC_GOODS_RECEIPT_V3                        │
│                                                                  │
│  INPUT:                                                          │
│  ├─ Material, Plant, Storage Loc, Quantity                      │
│  ├─ I_CREATE_TO = 'X' (optional)                                │
│  ├─ I_WAREHOUSE = '034' (required if CREATE_TO)                 │
│  └─ I_DEST_STORAGE_TYPE = '001' (destination)                   │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│  STEP 1: Post Goods Receipt                                      │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  BAPI_GOODSMVT_CREATE                                     │   │
│  │  - GM_CODE = '01' (PO) or '05' (Other)                   │   │
│  │  - Movement Type = 101 or 501                            │   │
│  │  → Creates Material Document                              │   │
│  │  → Stock placed in Storage Type 902 (interim)            │   │
│  └──────────────────────────────────────────────────────────┘   │
│                         │                                        │
│                         ▼                                        │
│  E_MAT_DOC = '5000003662', E_MAT_YEAR = '2026'                  │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│  STEP 2: Create Transfer Order (if I_CREATE_TO = 'X')           │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  L_TO_CREATE_SINGLE                                       │   │
│  │  - I_LGNUM = '034' (Warehouse)                           │   │
│  │  - I_BWLVS = '999' (WM Movement Type)                    │   │
│  │  - I_VLTYP = '902' (Source: GR interim)                  │   │
│  │  - I_NLTYP = '001' (Dest: Final storage)                 │   │
│  │  → Creates Transfer Order                                 │   │
│  │  → Moves stock from 902 to destination                   │   │
│  └──────────────────────────────────────────────────────────┘   │
│                         │                                        │
│                         ▼                                        │
│  E_TO_NUMBER = '0000012345'                                      │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│  OUTPUT:                                                         │
│  ├─ E_MAT_DOC    = '5000003662' (Material Document)             │
│  ├─ E_MAT_YEAR   = '2026'                                       │
│  ├─ E_TO_NUMBER  = '0000012345' (Transfer Order)                │
│  ├─ E_SUBRC      = 0 (Success)                                  │
│  └─ E_MESSAGE    = '' (No errors)                               │
└─────────────────────────────────────────────────────────────────┘
```

---

## 9. Python Integration Example

```python
# Example: Calling Z_RFC_GOODS_RECEIPT_V3 from Python

from pyrfc import Connection

def post_goods_receipt_with_to(
    conn: Connection,
    material: str,
    plant: str,
    storage_loc: str,
    quantity: float,
    create_to: bool = False,
    warehouse: str = None,
    dest_storage_type: str = None,
    dest_bin: str = None,
    confirm_to: bool = False
):
    """
    Post goods receipt with optional Transfer Order creation.
    
    Args:
        conn: SAP RFC connection
        material: Material number
        plant: Plant code
        storage_loc: Storage location
        quantity: Quantity
        create_to: If True, creates Transfer Order for putaway
        warehouse: Warehouse number (required if create_to=True)
        dest_storage_type: Destination storage type for TO
        dest_bin: Destination bin for TO (optional)
        confirm_to: If True, auto-confirms the TO
    
    Returns:
        dict with mat_doc, mat_year, to_number, subrc, message
    """
    
    params = {
        'I_MATERIAL': material.upper().zfill(18),
        'I_PLANT': plant,
        'I_STORAGE_LOC': storage_loc,
        'I_QUANTITY': quantity,
        'I_MOVEMENT_TYPE': '501',
        'I_CREATE_TO': 'X' if create_to else ' ',
    }
    
    if create_to:
        if not warehouse:
            raise ValueError("Warehouse required when create_to=True")
        params['I_WAREHOUSE'] = warehouse
        params['I_SRC_STORAGE_TYPE'] = '902'  # GR interim
        if dest_storage_type:
            params['I_DEST_STORAGE_TYPE'] = dest_storage_type
        if dest_bin:
            params['I_DEST_STORAGE_BIN'] = dest_bin
        params['I_CONFIRM_TO'] = 'X' if confirm_to else ' '
    
    result = conn.call('Z_RFC_GOODS_RECEIPT_V3', **params)
    
    return {
        'success': result['E_SUBRC'] == 0,
        'mat_doc': result.get('E_MAT_DOC'),
        'mat_year': result.get('E_MAT_YEAR'),
        'to_number': result.get('E_TO_NUMBER'),
        'message': result.get('E_MESSAGE', '')
    }


# Usage Example:
"""
result = post_goods_receipt_with_to(
    conn=sap_connection,
    material='EWMS4-01',
    plant='1010',
    storage_loc='0034',
    quantity=10,
    create_to=True,
    warehouse='034',
    dest_storage_type='001',
    confirm_to=False
)

if result['success']:
    print(f"GR Posted: {result['mat_doc']}/{result['mat_year']}")
    if result['to_number']:
        print(f"TO Created: {result['to_number']}")
else:
    print(f"Error: {result['message']}")
"""
```

---

## 10. Troubleshooting Guide

### Common Errors and Solutions

| Error | Cause | Solution |
|-------|-------|----------|
| "Material not found in warehouse" | Material not configured for WM | Check MLGN table for material/warehouse assignment |
| "Invalid source storage type" | Storage type 902 doesn't exist | Verify storage type in T301 |
| "Destination storage type missing" | I_DEST_STORAGE_TYPE not provided | Provide destination storage type |
| "Manual TO creation forbidden" | Warehouse config disallows manual TO | Check T300-TOAUF flag |
| "No authority" | User missing WM authorization | Check S_L2C_* authorization objects |
| "Object locked" | TO creation blocked by another user | Retry or check lock entries (SM12) |

### Debugging Tips

1. **Check Material in Warehouse:**
   ```sql
   SELECT * FROM MLGN WHERE MATNR = 'EWMS4-01' AND LGNUM = '034'
   ```

2. **Check Storage Type Configuration:**
   ```sql
   SELECT * FROM T301 WHERE LGNUM = '034'
   ```

3. **Check Movement Type Configuration:**
   ```sql
   SELECT * FROM T333 WHERE LGNUM = '034' AND BWLVS = '999'
   ```

4. **Monitor TOs:**
   - Transaction LT21/LT22 - Display TO
   - Transaction LT23 - TO List

---

## Appendix A: Related Transactions

| TCode | Description |
|-------|-------------|
| SE37 | Function Builder (create/edit function) |
| MIGO | Goods Movement (test GR manually) |
| LT01 | Create Transfer Order (manual) |
| LT21 | Display Transfer Order |
| LT23 | Display Transfer Orders List |
| LB01 | Create Transfer Requirement |
| LS03N | Display Storage Bin |
| LX02 | Stock List |

---

## Appendix B: SAP Notes Reference

| Note | Description |
|------|-------------|
| 115261 | L_TO_CREATE_SINGLE documentation |
| 184570 | WM Movement type configuration |
| 555664 | WM Integration troubleshooting |

---

---

## Appendix C: Verified WM Configuration (System S23/100)

### C.1 Storage Location Assignment (T320)

**Verified:** 2026-01-27 via SE16

| Field | Value | Description |
|-------|-------|-------------|
| MANDT | 100 | Client |
| WERKS | 1010 | Plant |
| LGORT | 0034 | Storage Location |
| LGNUM | **034** | **Warehouse Number** |
| OBEST | - | Reorder Point Storage Loc |
| LGNTB | - | TB-referenced warehouse |
| SLGOR | - | Subsequent storage location |

**Conclusion:** Storage Location 0034 in Plant 1010 is WM-enabled and assigned to Warehouse 034.

### C.2 Storage Types in Warehouse 034 (T301)

**Verified:** 2026-01-27 via SE16 - 37 storage types found

#### Key Storage Types for GR + TO Operations:

| LGTYP | Description | Purpose |
|-------|-------------|---------|
| **902** | **GR Area External Rcpts** | **Source for TO after GR (GR Interim)** |
| 901 | GR Area for Production | GR interim for production |
| 001 | High Rack Storage | Putaway destination |
| 002 | Shelf Storage | Putaway destination |
| 003 | Open Storage | Putaway destination |
| 004 | Bulk Storage | Putaway destination |
| 005 | Fixed Bin Storage | Putaway destination |
| 006 | Hazardous Materials Whse | Special storage |
| 007 | Pallet Storage | Putaway destination |
| 010 | High Rack with ID Point | Putaway destination |
| 050 | Fixed Bin Storage (no SU) | Putaway destination |
| 100 | Production Supply | Production area |
| 910 | GI Area General | Goods Issue |
| 916 | Shipping Area Deliveries | Outbound |
| 917 | Quality Assurance | QA inspection |

#### Recommended Destination Storage Types for Putaway:

| Priority | LGTYP | Description | Use Case |
|----------|-------|-------------|----------|
| 1 | 001 | High Rack Storage | General finished goods |
| 2 | 005 | Fixed Bin Storage | Items with fixed locations |
| 3 | 002 | Shelf Storage | Smaller items |
| 4 | 007 | Pallet Storage | Palletized goods |

### C.3 Movement Type Mapping

**Verified:** 2026-01-27 via SE16

#### IM Movement Type 101:
- **Purpose:** Goods Receipt for Purchase Order
- **Linked Transactions:** MB01, MB0A (MIGO), CO11N, etc.
- **XKZBEW:** 3 (GR-related)

#### WM Movement Type Recommendation:
- **WM Type 999:** Manual Transfer Order (recommended for programmatic TO creation)
- **Source:** Storage Type 902 (GR Area External Rcpts)
- **Destination:** Any putaway storage type (001, 002, 005, 007, etc.)

### C.4 Steps to Enable WM for Storage Location 101A (If Needed)

**Prerequisites:**
- SAP S/4HANA system with WM module activated
- Authorization for SPRO customizing

**Step-by-Step Guide:**

1. **Access SPRO:**
   ```
   Transaction: SPRO
   Path: IMG > Logistics Execution > Warehouse Management > 
         Interfaces > Inventory Management > Assign Warehouse Number to Plant/Storage Location
   ```

2. **Create T320 Entry:**
   - Click "New Entries"
   - Enter:
     - WERKS = 1010 (Plant)
     - LGORT = 101A (Storage Location)
     - LGNUM = 034 (Warehouse Number - use existing warehouse)
   - Save

3. **Alternative via SE16N (Display/Maintain):**
   ```
   Transaction: SE16N
   Table: T320
   Add entry: WERKS=1010, LGORT=101A, LGNUM=034
   ```

4. **Verify in MM03:**
   - Check that material has warehouse views (MLGN) for warehouse 034
   - If not, extend material master with warehouse data

5. **Test Configuration:**
   - Post GR to storage location 101A
   - Verify stock lands in storage type 902
   - Create TO to move stock to final destination

### C.5 Quick Reference for L_TO_CREATE_SINGLE Parameters

For Warehouse 034 GR Putaway:

```
I_LGNUM           = '034'          " Warehouse Number
I_BWLVS           = '999'          " WM Movement Type (Manual TO)
I_MATNR           = '<material>'   " Material Number
I_WERKS           = '1010'         " Plant
I_LGORT           = '0034'         " Storage Location
I_ANFME           = <quantity>     " Quantity
I_VLTYP           = '902'          " Source Storage Type (GR Interim)
I_NLTYP           = '001'          " Destination Storage Type (High Rack)
I_SQUIT           = 'X'            " Optional: Auto-confirm TO
I_COMMIT_WORK     = 'X'            " Commit transaction
```

---

*Document Version: 1.1*
*Created: 2026-01-27*
*Last Updated: 2026-01-27 (Added Appendix C: Verified WM Configuration)*
*Research conducted on: SAP S/4HANA 2023 FPS00 (S23/100)*
*Warehouse: 034 (Student034), Plant: 1010, Storage Location: 0034*
