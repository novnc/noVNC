FROM rustlang/rust:nightly

RUN rustup target add wasm32-unknown-unknown --toolchain nightly

RUN cargo install wasm-bindgen-cli

RUN curl -sL https://deb.nodesource.com/setup_10.x | bash -
RUN apt -y install nodejs

