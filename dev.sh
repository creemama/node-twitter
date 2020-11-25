#!/bin/sh

script_dir="$(
	cd "$(dirname "$0")"
	pwd -P
)"
cd "$script_dir"
if [ ! -f shellutil/shellutil.sh ]; then
	git submodule update --init
fi
# shellcheck source=shellutil/mainutil.sh
. shellutil/mainutil.sh
# shellcheck source=shellutil/shellutil.sh
. shellutil/shellutil.sh
# shellcheck source=shellutil/updateutil.sh
. shellutil/updateutil.sh
# set -o xtrace

node_image=creemama/node-no-yarn:14.15.1-alpine3.11

deploy() {
	# shellcheck disable=SC2039
	local current_version
	current_version="$(./cli.js --version)"
	# shellcheck disable=SC2039
	local major_version
	major_version="$(printf %s "$current_version" | sed -E 's/([0-9]+)\.[0-9]+\.[0-9]+/\1/')"
	# shellcheck disable=SC2039
	local minor_version
	minor_version="$(printf %s "$current_version" | sed -E 's/[0-9]+\.([0-9]+)\.[0-9]+/\1/')"
	# shellcheck disable=SC2039
	local patch_version
	patch_version="$(printf %s "$current_version" | sed -E 's/[0-9]+\.[0-9]+\.([0-9]+)/\1/')"

	# shellcheck disable=SC2039
	local new_version
	# shellcheck disable=SC2039
	local commit_type
	while true; do
		printf %s 'Is this a [m]ajor, m[i]nor, or [p]atch fix? '
		read -r aip
		case "$aip" in
		[Mm]*)
			new_version="$((major_version + 1)).0.0"
			commit_type=feat!
			break
			;;
		[Ii]*)
			new_version="$major_version.$((minor_version + 1)).0"
			commit_type=feat
			break
			;;
		[Pp]*)
			new_version="$major_version.$minor_version.$((patch_version + 1))"
			commit_type=fix
			break
			;;
		*) echo 'Answer m for major, i for minor, or p for patch.' ;;
		esac
	done

	sed -E -i'' \
		's/^  "version": ".*("[,]?)/  "version": "'"$new_version"'\1/' \
		package.json
	sed -E -i'' \
		's/^  "version": ".*("[,]?)/  "version": "'"$new_version"'\1/' \
		package-lock.json

	export GPG_TTY
	GPG_TTY=/dev/console
	./shellutil/git.sh git commit -am "$commit_type: bump node-twitter to v$new_version"
	npm adduser
	npm publish --access public
	./shellutil/git.sh git push origin master
}

main() {
	# shellcheck disable=SC2039
	local command_help
	command_help='deploy - Bump the version number and deploy to npm.
docker - Develop inside a Docker container.
docker-deploy - Run deploy using a Docker container.
docker-format - Run format using a Docker container.
docker-git - Run git using a Docker container.
docker-gitk - Run gitk using a Docker container.
docker-pkg - Run pkg using a Docker container.
docker-update - Run update using a Docker container.
format - Run prettier, shfmt, and shellcheck on this project.
git - Run git.
pkg - Create a standalone binary of this project.
update - Check and bump the version number of project dependencies.'
	# shellcheck disable=SC2039
	local commands
	commands="$(main_extract_commands "$command_help")"
	# shellcheck disable=SC2086
	if [ -z "${1:-}" ]; then
		main_exit_with_no_command_error "$command_help"
	elif [ "$1" = "$(arg 0 $commands)" ]; then
		deploy "$script_dir"
	elif [ "$1" = "$(arg 1 $commands)" ]; then
		shift
		run_docker "$@"
	elif [ "$1" = "$(arg 2 $commands)" ]; then
		run_docker_deploy
	elif [ "$1" = "$(arg 3 $commands)" ]; then
		./shellutil/format.sh docker-format
	elif [ "$1" = "$(arg 4 $commands)" ]; then
		shift
		./shellutil/git.sh docker-git "$@"
	elif [ "$1" = "$(arg 5 $commands)" ]; then
		shift
		./shellutil/git.sh docker-gitk "$@"
	elif [ "$1" = "$(arg 6 $commands)" ]; then
		run_docker -c "./dev.sh pkg"
	elif [ "$1" = "$(arg 7 $commands)" ]; then
		run_docker_update
	elif [ "$1" = "$(arg 8 $commands)" ]; then
		./shellutil/format.sh format
	elif [ "$1" = "$(arg 9 $commands)" ]; then
		shift
		./shellutil/git.sh git "$@"
	elif [ "$1" = "$(arg 10 $commands)" ]; then
		run_pkg
	elif [ "$1" = "$(arg 11 $commands)" ]; then
		update
	else
		main_exit_with_invalid_command_error "$1" "$command_help"
	fi
}

run_docker() {
	docker run -it --rm \
		--volume "$script_dir":/tmp \
		--volume ~/.gnupg:/root/.gnupg \
		--volume ~/.node-twitter:/root/.node-twitter \
		--volume ~/.ssh:/root/.ssh \
		--workdir /tmp \
		"$node_image" \
		sh "$@"
}

run_docker_deploy() {
	run_docker -c './dev.sh deploy'
	docker run --rm creemama/node-no-yarn:lts-alpine sh -c '
		npm install --global @util.js/node-twitter &&
		node-twitter'
}

run_docker_update() {
	docker pull creemama/node-no-yarn:lts-alpine
	docker run -it --rm \
		--volume "$(pwd):/tmp" \
		--workdir /tmp \
		creemama/node-no-yarn:lts-alpine \
		sh -c './dev.sh update'
}

run_pkg() {
	npx pkg --out-path target --targets node14-alpine-x64,node14-linux-x64,node14-macos-x64,node14-win-x64 .
}

update() {
	# shellcheck disable=SC2119
	apk_update_node_image_version
	apk_update_package_version git
	apk_update_package_version gnupg
	apk_update_package_version openssh
	npx ncu -u
	./shellutil/git.sh git status
}

main "$@"
