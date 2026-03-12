"""
SAP RFC Outbound Workflow CLI Script (MANUAL OPERATION -- NOT A PYTEST TEST)
============================================================================
Tests the Z_RFC_OUTBOUND_COMPLETE function module.

Renamed from test_sap_outbound.py to prevent accidental pytest collection.

Prerequisites:
1. Set SAPNWRFC_HOME environment variable to SDK path
2. Install pyrfc: pip install pyrfc

Usage:
  python sap_outbound_cli.py <delivery_number> [--commit]
"""

import os
import sys
import argparse

# Set SDK path before importing pyrfc
SDK_PATH = os.getenv('SAPNWRFC_HOME', '')
if SDK_PATH:
    os.environ['PATH'] = os.path.join(SDK_PATH, 'lib') + ';' + os.environ.get('PATH', '')

try:
    from pyrfc import Connection, RFCError
    PYRFC_AVAILABLE = True
except ImportError as e:
    PYRFC_AVAILABLE = False
    print(f"❌ pyrfc not available: {e}")
    print("\nTo install pyrfc:")
    print(f"  1. Set SAPNWRFC_HOME={SDK_PATH}")
    print("  2. pip install pyrfc")
    sys.exit(1)


# SAP Connection Parameters
SAP_CONFIG = {
    'user': os.getenv('SAP_DEFAULT_USER', 'STUDENT119'),
    'passwd': os.getenv('SAP_DEFAULT_PASSWD', ''),  # Will prompt if empty
    'ashost': os.getenv('SAP_DEFAULT_ASHOST', '172.21.72.22'),
    'sysnr': os.getenv('SAP_DEFAULT_SYSNR', '00'),
    'client': os.getenv('SAP_DEFAULT_CLIENT', '100'),
    'lang': 'EN',
    'saprouter': os.getenv('SAP_DEFAULT_SAPROUTER', '/H/161.38.17.212'),
}


def test_connection(conn):
    """Test basic SAP connection."""
    print("\n📡 Testing SAP Connection...")
    try:
        result = conn.call('STFC_CONNECTION', REQUTEXT='OmniFrame Test')
        print(f"   ✅ Connection successful!")
        print(f"   Echo: {result.get('ECHOTEXT', '')}")
        print(f"   Response: {result.get('RESPTEXT', '')[:50]}...")
        return True
    except RFCError as e:
        print(f"   ❌ Connection failed: {e}")
        return False


def test_outbound_workflow(conn, delivery, commit=False):
    """Test the Z_RFC_OUTBOUND_COMPLETE function."""
    print(f"\n🚚 Testing Outbound Workflow for Delivery: {delivery}")
    print(f"   Commit Mode: {'YES - WILL SAVE CHANGES' if commit else 'NO - TEST ONLY'}")
    
    try:
        result = conn.call(
            'Z_RFC_OUTBOUND_COMPLETE',
            IV_VBELN=delivery.zfill(10),  # Pad to 10 digits
            IV_LGNUM='',
            IV_TANUM='',
            IV_VSTEL='',
            IV_ROUTE='',
            IV_TDLNR='',
            IV_PRINT_DOCS='X',
            IV_COMMIT='X' if commit else ' '
        )
        
        subrc = result.get('EV_SUBRC', 99)
        message = result.get('EV_MESSAGE', '')
        step_failed = result.get('EV_STEP_FAILED', '')
        shipment = result.get('EV_TKNUM', '').strip()
        delivery_packed = result.get('EV_VBELN_PACKED', '').strip()
        to_confirmed = result.get('EV_TANUM_CONFIRMED', '').strip()
        
        print(f"\n   📊 Results:")
        print(f"   Return Code (EV_SUBRC): {subrc}")
        print(f"   Message: {message}")
        
        if subrc == 0:
            print(f"\n   ✅ SUCCESS!")
            if shipment:
                print(f"   Shipment Created: {shipment}")
            if delivery_packed:
                print(f"   Delivery Packed: {delivery_packed}")
            if to_confirmed:
                print(f"   TO Confirmed: {to_confirmed}")
        else:
            print(f"\n   ❌ FAILED at step: {step_failed}")
            
        # Print return messages if any
        return_msgs = result.get('T_RETURN', [])
        if return_msgs:
            print(f"\n   📝 Return Messages:")
            for msg in return_msgs[:10]:  # Show first 10 messages
                msg_type = msg.get('TYPE', '')
                msg_text = msg.get('MESSAGE', '') or f"{msg.get('ID', '')}-{msg.get('NUMBER', '')}"
                print(f"      [{msg_type}] {msg_text}")
                
        return subrc == 0
        
    except RFCError as e:
        error_str = str(e)
        print(f"\n   ❌ RFC Error: {error_str}")
        
        if 'FU_NOT_FOUND' in error_str or 'FUNCTION_NOT_FOUND' in error_str:
            print("\n   ⚠️  Function Z_RFC_OUTBOUND_COMPLETE not found in SAP!")
            print("   Please create it in SE37 first.")
        elif 'RFC_LOGON_FAILURE' in error_str:
            print("\n   ⚠️  Login failed - check credentials")
        
        return False


def main():
    parser = argparse.ArgumentParser(description='Test SAP Outbound Workflow')
    parser.add_argument('delivery', nargs='?', help='Delivery number to process')
    parser.add_argument('--commit', action='store_true', help='Actually commit changes (default: test only)')
    parser.add_argument('--password', '-p', help='SAP password (will prompt if not provided)')
    parser.add_argument('--ping', action='store_true', help='Only test connection, no workflow')
    args = parser.parse_args()
    
    # Get password
    password = args.password or SAP_CONFIG['passwd']
    if not password:
        import getpass
        password = getpass.getpass('Enter SAP password: ')
    
    SAP_CONFIG['passwd'] = password
    
    print("=" * 60)
    print("SAP RFC Outbound Workflow Test - OmniFrame")
    print("=" * 60)
    print(f"\nConnecting to: {SAP_CONFIG['ashost']}")
    print(f"System: {SAP_CONFIG['sysnr']}, Client: {SAP_CONFIG['client']}")
    print(f"User: {SAP_CONFIG['user']}")
    
    try:
        with Connection(**SAP_CONFIG) as conn:
            # Test basic connection
            if not test_connection(conn):
                return 1
            
            # If only ping requested, stop here
            if args.ping:
                print("\n✅ Connection test complete!")
                return 0
            
            # Need a delivery number
            if not args.delivery:
                print("\n⚠️  No delivery number provided.")
                print("Usage: python test_sap_outbound.py <delivery_number> [--commit]")
                print("\nTo just test connection: python test_sap_outbound.py --ping")
                return 1
            
            # Test the outbound workflow
            success = test_outbound_workflow(conn, args.delivery, args.commit)
            
            print("\n" + "=" * 60)
            if success:
                print("✅ Test completed successfully!")
            else:
                print("❌ Test completed with errors")
            print("=" * 60)
            
            return 0 if success else 1
            
    except Exception as e:
        print(f"\n❌ Error: {e}")
        return 1


if __name__ == '__main__':
    sys.exit(main())
