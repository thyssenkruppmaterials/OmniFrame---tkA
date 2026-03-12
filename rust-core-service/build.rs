//! Build script for rust-core-service
//!
//! This build script is prepared for future gRPC support using tonic-build.
//! Currently, the REST API covers all functionality.

fn main() {
    // Uncomment to enable gRPC proto compilation:
    //
    // tonic_build::configure()
    //     .build_server(true)
    //     .build_client(true)
    //     .out_dir("src/grpc/generated")
    //     .compile(
    //         &["src/grpc/proto/core.proto"],
    //         &["src/grpc/proto"],
    //     )
    //     .expect("Failed to compile proto files");

    // Rerun if proto files change
    println!("cargo:rerun-if-changed=src/grpc/proto/core.proto");
}
